import { describe, expect, it } from "vitest";
import { inferPropertyCategory } from "./property-category-infer";

describe("Release 1.3.1 — inferência de categoria de imóveis", () => {
  it("1. categoria existente nunca é sobreposta", () => {
    const r = inferPropertyCategory({
      categoria: "trespasses",
      tipo_imovel: "apartamento",
      tipologia: "T2",
    });
    expect(r.categoria).toBe("trespasses");
    expect(r.origem).toBe("existente");
  });

  it("2. tipo_imovel resolve a categoria", () => {
    const r = inferPropertyCategory({ tipo_imovel: "moradia" });
    expect(r.categoria).toBe("casas_apartamentos");
    expect(r.origem).toBe("tipo_imovel");
  });

  it("2b. subtipo_imovel tem prioridade sobre tipo_imovel", () => {
    const r = inferPropertyCategory({ tipo_imovel: null, subtipo_imovel: "Armazém" });
    expect(r.categoria).toBe("comercial_armazens");
    expect(r.origem).toBe("tipo_imovel");
  });

  it("3. tipologia T1 sem tipo resolve casas_apartamentos", () => {
    const r = inferPropertyCategory({ tipo_imovel: null, categoria: null, tipologia: "T1" });
    expect(r.categoria).toBe("casas_apartamentos");
    expect(r.origem).toBe("tipologia");
  });

  it("4. texto de lar de idosos resolve trespasses", () => {
    const r = inferPropertyCategory({
      descricao: "Lar de idosos em funcionamento, licenciado, 60 camas",
    });
    expect(r.categoria).toBe("trespasses");
    expect(r.origem).toBe("inferido_texto");
  });

  it("5. 'T3 com lugar de garagem' não vira comercial_armazens", () => {
    const r = inferPropertyCategory({
      titulo: "T3 com lugar de garagem",
      tipologia: "T3",
    });
    expect(r.categoria).toBe("casas_apartamentos");
    expect(r.sinais).not.toContain("comercial_armazens");
  });

  it("5b. texto sem sinal de tipo de imóvel fica indecidível", () => {
    const r = inferPropertyCategory({
      descricao: "Excelente oportunidade de investimento, ótima exposição solar",
    });
    expect(r.categoria).toBeNull();
    expect(r.origem).toBe("indecidivel");
    expect(r.sinais).toHaveLength(0);
  });

  it("6. sem qualquer sinal fica indecidível", () => {
    const r = inferPropertyCategory({ referencia: "C0440-01014" });
    expect(r.categoria).toBeNull();
    expect(r.origem).toBe("indecidivel");
  });
});
