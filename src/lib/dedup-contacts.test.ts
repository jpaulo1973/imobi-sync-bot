import { describe, it, expect } from "vitest";
import { normalizeTextKey, textJaccard, normalizePhone } from "./dedup";
import { normContactName, knownPhoneFor, type KnownContact } from "./contacts.server";

describe("normContactName", () => {
  it("normaliza acentos, caixa e pontuação", () => {
    expect(normContactName("CASA BELLA")).toBe("casa bella");
    expect(normContactName("Casa Béllá  -  Imóveis")).toBe("casa bella imoveis");
    expect(normContactName("  ")).toBe("");
    expect(normContactName(null)).toBe("");
  });
  it("mantém sufixos distintos (C21N2) como parte da chave", () => {
    expect(normContactName("Casa Bella C21N2")).not.toBe(normContactName("Casa Bella"));
  });
});

describe("normalizeTextKey / textJaccard", () => {
  it("considera idêntico o mesmo texto com espaços e acentos diferentes", () => {
    const a = "Procura T3 em Cascais  até 500.000€";
    const b = "procura t3 em cascais até 500.000€";
    expect(normalizeTextKey(a)).toBe(normalizeTextKey(b));
  });
  it("textos diferentes têm jaccard baixo", () => {
    expect(textJaccard("procura t3 cascais garagem", "vendo terreno alentejo agricola")).toBeLessThan(0.2);
  });
  it("textos praticamente iguais têm jaccard alto", () => {
    expect(
      textJaccard("procura apartamento t3 cascais garagem", "procura apartamento t3 cascais garagem"),
    ).toBe(1);
  });
});

describe("telefone efetivo / contactos conhecidos", () => {
  it("normaliza formatos PT ao mesmo valor", () => {
    expect(normalizePhone("+351 912 345 678")).toBe(normalizePhone("912345678"));
    expect(normalizePhone("00351912345678")).toBe(normalizePhone("912345678"));
  });
  it("recupera telefone conhecido por nome normalizado", () => {
    const map = new Map<string, KnownContact>([
      [
        "casa bella",
        {
          nome_normalizado: "casa bella",
          nome_display: "CASA BELLA",
          telefone: "912345678",
          email: null,
          agency: null,
          times_seen: 3,
        },
      ],
    ]);
    expect(knownPhoneFor(map, "Casa Bellá")).toBe("912345678");
    expect(knownPhoneFor(map, "Outra Pessoa")).toBeNull();
    expect(knownPhoneFor(map, null)).toBeNull();
  });
});
