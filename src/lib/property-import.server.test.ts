import { describe, expect, it } from "vitest";
import {
  buildPropertyInsert,
  extractStructuredAreasFromHtml,
  mergeStructuredAreas,
  type ParsedProperty,
} from "./property-import.server";

const c044001018Html = `
  <ul>
    <li><p>Área útil</p><p>205<!-- --> m²</p></li>
    <li><p>Área bruta</p><p>228<!-- --> m²</p></li>
    <li><p>Área terreno</p><p>14000<!-- --> m²</p></li>
    <li><p>Referência</p><p>C0440-01018</p></li>
  </ul>
`;

describe("property import area mapping", () => {
  it("extrai as três áreas estruturadas da Century21 sem trocar bruta por terreno", () => {
    expect(extractStructuredAreasFromHtml(c044001018Html)).toEqual({
      area_util_m2: 205,
      area_bruta_m2: 228,
      area_terreno_m2: 14000,
    });
  });

  it("corrige C0440-01018 quando a IA confunde área bruta com área de terreno", () => {
    const aiParsed: ParsedProperty = {
      referencia: "C0440-01018",
      finalidade: "venda",
      tipo_imovel: "quinta",
      tipologia: "T2",
      preco: 1100000,
      distrito: "Santarém",
      concelho: "Benavente",
      freguesia: "Santo Estêvão",
      zona: "Santo Estêvão",
      area_util_m2: 205,
      area_bruta_m2: 228,
      area_terreno_m2: 228,
    };

    const merged = mergeStructuredAreas(aiParsed, c044001018Html);
    const { values } = buildPropertyInsert(merged);

    expect(values.area_m2).toBe(205);
    expect(values.area_util_m2).toBe(205);
    expect(values.area_bruta_m2).toBe(228);
    expect(values.area_terreno_m2).toBe(14000);
  });

  it("não grava área bruta como terreno quando falta etiqueta explícita de terreno", () => {
    const aiParsed: ParsedProperty = {
      referencia: "SEM-TERRENO",
      finalidade: "venda",
      tipo_imovel: "quinta",
      tipologia: "T2",
      preco: 500000,
      distrito: "Lisboa",
      concelho: "Lisboa",
      freguesia: "Lisboa",
      area_util_m2: 205,
      area_bruta_m2: 228,
      area_terreno_m2: 228,
    };

    const merged = mergeStructuredAreas(
      aiParsed,
      `<p>Área útil</p><p>205 m²</p><p>Área bruta</p><p>228 m²</p>`,
    );

    expect(merged.area_terreno_m2).toBeNull();
  });
});