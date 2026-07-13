import { describe, expect, it } from "vitest";
import { scoreMatch, isInvestorBulkSearch, type BuyerLike, type PropertyLike } from "./matching-engine";

describe("investor bulk search filter", () => {
  const auraBuyer: BuyerLike = {
    finalidade: "venda",
    tipo_imovel: ["Apartamento"],
    tipologia: "T0",
    zona: "Lisboa",
    municipio: "Lisboa",
    budget_max: 800000,
    caracteristicas: ["proj. aprovados >80 frações"],
    resumo:
      "Procura projetos aprovados para empreendimentos com mais de 80 frações em Lisboa para cliente investidor.",
  };

  const lisboaApartamento: PropertyLike = {
    finalidade: "venda",
    tipo_imovel: "apartamento",
    tipologia: "T2",
    distrito: "Lisboa",
    concelho: "Lisboa",
    freguesia: "Estrela",
    zona: "Campo de Ourique",
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
