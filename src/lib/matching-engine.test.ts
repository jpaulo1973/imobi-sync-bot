import { describe, expect, it } from "vitest";
import { scoreMatch, isInvestorBulkSearch, type BuyerLike, type PropertyLike } from "./matching-engine";

describe("investor bulk search filter", () => {
  const LISBOA_ID = "00000000-0000-0000-0000-00000000lisboa";
  const auraBuyer: BuyerLike = {
    finalidade: "venda",
    tipo_imovel: ["Apartamento"],
    tipologia: "T0",
    location_ids: [LISBOA_ID],
    budget_max: 800000,
    caracteristicas: ["proj. aprovados >80 frações"],
    resumo:
      "Procura projetos aprovados para empreendimentos com mais de 80 frações em Lisboa para cliente investidor.",
  };

  const lisboaApartamento: PropertyLike = {
    finalidade: "venda",
    tipo_imovel: "apartamento",
    tipologia: "T2",
    location_id: LISBOA_ID,
    preco: 285000,
    area_util_m2: 60,
    quartos: 2,
  };

  it("detects investor/bulk intent from caracteristicas and resumo", () => {
    expect(isInvestorBulkSearch(auraBuyer)).toBe(true);
    expect(
      isInvestorBulkSearch({ resumo: "T2 remodelado com varanda" } as BuyerLike),
    ).toBe(false);
  });

  it("blocks investor bulk searches from matching single apartments", () => {
    const r = scoreMatch(auraBuyer, lisboaApartamento);
    expect(r.compatible).toBe(false);
  });

  it("still allows investor bulk searches to match Terreno/Prédio", () => {
    const terreno: PropertyLike = {
      ...lisboaApartamento,
      tipo_imovel: "terreno",
      area_terreno_m2: 5000,
    };
    // Fornecer também Terreno como tipo procurado para passar o tipoFilter base.
    const buyer = { ...auraBuyer, tipo_imovel: ["Apartamento", "Terreno"] };
    const r = scoreMatch(buyer, terreno);
    expect(r.compatible).toBe(true);
  });
});
