import { describe, it, expect } from "vitest";
import { pairKey, propertyLabel, reasonSummary, sweepForUser } from "./match-notifications.server";

const USER = "11111111-1111-1111-1111-111111111111";

const property = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  user_id: USER,
  ativo: true,
  referencia: "REF-1",
  finalidade: "venda",
  tipo_imovel: "apartamento",
  tipologia: "T2",
  zona: "Lisboa",
  preco: 300000,
  area_util_m2: 90,
  quartos: 2,
  location_id: "loc-1",
};

const buyer = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  user_id: USER,
  ativo: true,
  nome: "Ana",
  finalidade: "venda",
  tipo_imovel: null,
  tipologia: "T2",
  location_ids: ["loc-1"],
  budget_min: null,
  budget_max: 350000,
  area_min: null,
  quartos_min: null,
  garagem_obrigatoria: false,
  elevador_obrigatorio: false,
};

function fakeAdmin() {
  return {
    from(table: string) {
      const data =
        table === "properties" ? [property] : table === "buyer_clients" ? [buyer] : [];
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        then: (res: any) => Promise.resolve({ data, error: null }).then(res),
      };
      return chain;
    },
  };
}

describe("notificações de match — varredura", () => {
  it("pair_key identifica o par cliente+imóvel", () => {
    expect(pairKey("cliente", "b1", "p1")).toBe("cliente:b1:p1");
    expect(pairKey("search", "s1", "p1")).not.toBe(pairKey("cliente", "s1", "p1"));
  });

  it("etiqueta e resumo são legíveis", () => {
    expect(propertyLabel(property)).toContain("REF-1");
    expect(reasonSummary(["a", "b", "c", "d"])).toBe("a · b · c");
  });

  it("gera no máximo uma linha por par e é estável entre varreduras", async () => {
    const first = await sweepForUser(fakeAdmin(), USER);
    const second = await sweepForUser(fakeAdmin(), USER);
    const keys = first.rows.map((r) => r.pair_key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(second.rows.map((r) => r.pair_key)).toEqual(keys);
    // Idempotência real vem da unicidade (user_id, pair_key) na base de dados:
    // as mesmas chaves ⇒ nenhuma inserção nova.
  });
});
