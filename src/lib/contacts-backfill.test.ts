import { describe, it, expect } from "vitest";
import {
  aggregateContacts,
  normNameForBackfill,
  normalizePhoneStrict,
  type BackfillSourceRow,
} from "./contacts-backfill";
import { normContactName } from "./contacts.server";

const U = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";

const row = (o: Partial<BackfillSourceRow>): BackfillSourceRow => ({
  user_id: U,
  created_at: "2026-07-08T10:00:00Z",
  ...o,
});

describe("normalização", () => {
  it("é idêntica à usada no lookup de contactos", () => {
    for (const n of ["CASA BELLA", "Casa Béllá - Imóveis", "  ", "Rui Ferreirinha"]) {
      expect(normNameForBackfill(n)).toBe(normContactName(n));
    }
  });
  it("colapsa formatos PT no mesmo número", () => {
    expect(normalizePhoneStrict("+351 920 505 485")).toBe("920505485");
    expect(normalizePhoneStrict("00351920505485")).toBe("920505485");
    expect(normalizePhoneStrict("920505485")).toBe("920505485");
    expect(normalizePhoneStrict("12345")).toBeNull();
  });
});

describe("agregação", () => {
  it("exclui pares de consultores com conta apagada e reporta-os à parte", () => {
    const res = aggregateContacts([
      row({ contact_nome: "Ana", contact_telefone: "912000000" }),
      row({ contact_nome: "Orfa", contact_telefone: "913000000", user_exists: false }),
    ]);
    expect(res.pares.map((p) => p.nome_normalizado)).toEqual(["ana"]);
    expect(res.orfaos_pares).toBe(1);
    expect(res.orfaos_nomes).toEqual(["orfa"]);
  });

  it("colapsa acentos/caixa/formatos num único par com contagem certa", () => {
    const res = aggregateContacts([
      row({ contact_nome: "CASA BELLA", consultor_telefone: "+351 920 505 485" }),
      row({ contact_nome: "Casa Béllá", contact_telefone: "00351920505485" }),
      row({ contact_nome: "casa bella", contact_telefone: "920505485", created_at: "2026-08-19T13:53:00Z" }),
    ]);
    expect(res.pares).toHaveLength(1);
    expect(res.pares[0]).toMatchObject({
      nome_normalizado: "casa bella",
      telefone: "920505485",
      times_seen: 3,
      last_seen_at: "2026-08-19T13:53:00Z",
    });
    expect(res.ambiguos).toHaveLength(0);
  });

  it("usa o telefone do comprador antes do consultor", () => {
    const res = aggregateContacts([
      row({ contact_nome: "Ana", contact_telefone: "912000000", consultor_telefone: "913000000" }),
    ]);
    expect(res.pares[0].telefone).toBe("912000000");
  });

  it("nome com dois telefones NÃO escreve nada, mesmo sem empate", () => {
    const res = aggregateContacts([
      row({ contact_nome: "Bernardo Santos", contact_telefone: "916800876", contact_email: "b@gmail.com" }),
      row({ contact_nome: "Bernardo Santos", contact_telefone: "916800876" }),
      row({ contact_nome: "Bernardo Santos", contact_telefone: "916800876" }),
      row({ contact_nome: "Bernardo Santos", contact_telefone: "961823020", contact_email: "p@mmparts.pt" }),
    ]);
    expect(res.pares).toHaveLength(0);
    expect(res.nomes_ambiguos).toBe(1);
    const amb = res.ambiguos[0];
    expect(amb.nome_normalizado).toBe("bernardo santos");
    expect(amb.telefones.map((t) => [t.telefone, t.procuras])).toEqual([
      ["916800876", 3],
      ["961823020", 1],
    ]);
    expect(amb.telefones[0].emails).toContain("b@gmail.com");
  });

  it("empate 1–1 também fica de fora", () => {
    const res = aggregateContacts([
      row({ contact_nome: "Maria Carvalho", contact_telefone: "967669621" }),
      row({ contact_nome: "Maria Carvalho", contact_telefone: "964235688" }),
    ]);
    expect(res.pares).toHaveLength(0);
    expect(res.ambiguos).toHaveLength(1);
  });

  it("rótulo genérico com muitos telefones é excluído pela mesma regra", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({ contact_nome: "Club Member", contact_telefone: `91${String(1000000 + i)}` }),
    );
    const res = aggregateContacts(rows);
    expect(res.pares).toHaveLength(0);
    expect(res.ambiguos[0].nome_normalizado).toBe("club member");
    expect(res.ambiguos[0].telefones).toHaveLength(40);
  });

  it("a ambiguidade do nome vale entre utilizadores diferentes", () => {
    const res = aggregateContacts([
      { user_id: U, contact_nome: "Colega", contact_telefone: "911111111", created_at: "2026-07-08T10:00:00Z" },
      { user_id: U2, contact_nome: "Colega", contact_telefone: "922222222", created_at: "2026-07-08T10:00:00Z" },
    ]);
    expect(res.pares).toHaveLength(0);
    expect(res.nomes_ambiguos).toBe(1);
  });

  it("mesmo nome+telefone em carteiras diferentes gera um par por utilizador", () => {
    const res = aggregateContacts([
      { user_id: U, contact_nome: "Ana", contact_telefone: "912000000", created_at: "2026-07-08T10:00:00Z" },
      { user_id: U2, contact_nome: "Ana", contact_telefone: "912000000", created_at: "2026-07-08T10:00:00Z" },
    ]);
    expect(res.pares).toHaveLength(2);
    expect(new Set(res.pares.map((p) => p.user_id))).toEqual(new Set([U, U2]));
  });

  it("linhas sem nome ou sem telefone válido contam como ignoradas", () => {
    const res = aggregateContacts([
      row({ contact_nome: "Sem Numero" }),
      row({ contact_telefone: "912000000" }),
      row({ contact_nome: "Curto", contact_telefone: "1234" }),
      row({ contact_nome: "Boa", contact_telefone: "912000001" }),
    ]);
    expect(res.linhas_ignoradas).toBe(3);
    expect(res.pares).toHaveLength(1);
  });

  it("é idempotente: agregar o mesmo input duas vezes dá o mesmo resultado", () => {
    const rows = [
      row({ contact_nome: "Ana", contact_telefone: "912000000" }),
      row({ contact_nome: "Rui", consultor_telefone: "913000000" }),
    ];
    expect(aggregateContacts(rows)).toEqual(aggregateContacts([...rows]));
  });

  it("cai para consultor_nome quando não há contact_nome", () => {
    const res = aggregateContacts([
      row({ consultor_nome: "Vitor Carvalho", consultor_telefone: "926101515" }),
    ]);
    expect(res.pares[0].nome_normalizado).toBe("vitor carvalho");
  });
});