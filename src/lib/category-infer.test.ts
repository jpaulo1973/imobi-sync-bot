// Release 1.2.12 — cobre os 4 estados do diagnóstico + regra de não sobrepor.
import { describe, it, expect } from "vitest";
import { inferSearchCategories, withInferredCategories, detectMultiUse } from "./category-infer";

describe("inferSearchCategories", () => {
  it("com_tipo + com_cat -> mantém existente (nunca sobrepõe)", () => {
    const r = inferSearchCategories({
      categorias: ["terrenos"],
      tipo_imovel: ["apartamento"],
      tipologia: "T3",
      texto_original: "procuro moradia",
    });
    expect(r.categoria_origem).toBe("existente");
    expect(r.categorias).toEqual(["terrenos"]);
  });

  it("com_tipo + sem_cat -> deriva do tipo_imovel", () => {
    const r = inferSearchCategories({ categorias: [], tipo_imovel: ["apartamento"] });
    expect(r.categoria_origem).toBe("tipo_imovel");
    expect(r.categorias.length).toBeGreaterThan(0);
  });

  it("sem_tipo + sem_cat mas com tipologia -> infere habitacional", () => {
    const r = inferSearchCategories({ tipologia: "T2" });
    expect(r.categoria_origem).toBe("tipologia");
    expect(r.categorias).toEqual(["casas_apartamentos"]);
  });

  it("sem_tipo + sem_cat + sem tipologia -> infere do texto original", () => {
    const r = inferSearchCategories({ texto_original: "Cliente procura terreno para construção" });
    expect(r.categoria_origem).toBe("inferido_texto");
    expect(r.categorias.length).toBeGreaterThan(0);
  });

  it("sem sinal nenhum -> indecidivel com categorias vazias", () => {
    const r = inferSearchCategories({ texto_original: "Bom dia, tenho cliente com 200.000" });
    expect(r.categoria_origem).toBe("indecidivel");
    expect(r.categorias).toEqual([]);
  });

  it("com_cat + sem_tipo -> mantém a categoria existente", () => {
    const r = inferSearchCategories({ categorias: ["terrenos"] });
    expect(r.categoria_origem).toBe("existente");
    expect(r.categorias).toEqual(["terrenos"]);
  });
});

describe("detectMultiUse (Release 1.2.13)", () => {
  it("Luísa Tinoco: urbano/industrial/habitacional -> multi-uso, vai para Revisão", () => {
    const r = inferSearchCategories({
      tipo_imovel: ["Armazém"],
      texto_original: "Imóvel urbano, industrial ou habitacional em Loures",
    });
    expect(r.multi_uso).toBe(true);
    expect(r.categoria_origem).toBe("indecidivel");
    expect(r.motivo_indecidivel).toBe("multi_uso");
    expect(r.categorias).toEqual([]);
    expect(r.sinais.length).toBeGreaterThan(1);
  });

  it("Sofia Coelho: armazém ou loja -> mesma categoria, NÃO é multi-uso", () => {
    const r = inferSearchCategories({ texto_original: "Armazém ou loja 200 a 400m2" });
    expect(r.multi_uso).toBe(false);
    expect(r.categorias).toEqual(["comercial_armazens"]);
  });

  it("João Batanete: prédio c/ AL ou Hostel -> multi-uso", () => {
    const r = inferSearchCategories({ texto_original: "Prédio c/ AL ou Hostel no centro" });
    expect(detectMultiUse({ texto_original: "Prédio c/ AL ou Hostel no centro" }).multi_uso).toBe(true);
    expect(r.categoria_origem).toBe("indecidivel");
    expect(r.motivo_indecidivel).toBe("multi_uso");
  });

  it("falso multi-uso: 'terreno para construção de moradia' -> só terrenos", () => {
    const r = inferSearchCategories({ texto_original: "Procura terreno para construção de moradia" });
    expect(r.multi_uso).toBe(false);
    expect(r.categoria_origem).toBe("inferido_texto");
    expect(r.categorias).toEqual(["terrenos"]);
  });

  it("falso multi-uso: 'loja para investimento' -> só comercial", () => {
    const r = inferSearchCategories({ texto_original: "Loja para investimento até 300.000" });
    expect(r.multi_uso).toBe(false);
    expect(r.categorias).toEqual(["comercial_armazens"]);
  });

  it("categorias já existentes -> existente, nunca multi-uso", () => {
    const r = inferSearchCategories({
      categorias: ["predios"],
      tipo_imovel: ["Armazém"],
      texto_original: "urbano, industrial ou habitacional",
    });
    expect(r.categoria_origem).toBe("existente");
    expect(r.multi_uso).toBe(false);
    expect(r.categorias).toEqual(["predios"]);
  });

  it("indecidível puro é marcado como sem_sinal", () => {
    const r = inferSearchCategories({ texto_original: "Bom dia, tenho cliente com 200.000" });
    expect(r.motivo_indecidivel).toBe("sem_sinal");
  });
});

describe("Release 1.2.16 — garagem/estacionamento não são tipo de imóvel", () => {
  it("Maia/Matosinhos: 'T3 ou T4 com lugar de garagem' -> só casas_apartamentos", () => {
    const r = inferSearchCategories({
      texto_original: "Cliente procura T3 ou T4 na Maia ou Matosinhos com lugar de garagem",
    });
    expect(r.multi_uso).toBe(false);
    expect(r.motivo_indecidivel).toBeNull();
    expect(r.categorias).toEqual(["casas_apartamentos"]);
  });

  it("Porto: 'T2 garagem ou lugar de garagem' -> só casas_apartamentos", () => {
    const r = inferSearchCategories({
      tipologia: "T2",
      texto_original: "T2 no Porto, com garagem ou lugar de garagem",
    });
    expect(r.multi_uso).toBe(false);
    expect(r.categorias).toEqual(["casas_apartamentos"]);
  });

  it("Terrugem/Magoito: 'Moradia T3, Garagem até 600 mil euros' -> só casas_apartamentos", () => {
    const r = inferSearchCategories({
      texto_original: "Moradia T3, Garagem, Terrugem ou Magoito até 600 mil euros",
    });
    expect(r.multi_uso).toBe(false);
    expect(r.motivo_indecidivel).toBeNull();
    expect(r.categorias).toEqual(["casas_apartamentos"]);
  });

  it("não-regressão: tipo_imovel Armazém + tipologia habitacional continua multi-uso", () => {
    const r = inferSearchCategories({ tipo_imovel: ["Armazém"], tipologia: "T3" });
    expect(r.multi_uso).toBe(true);
    expect(r.motivo_indecidivel).toBe("multi_uso");
  });

  it("não-regressão: 'loja com armazém' continua comercial_armazens", () => {
    const r = inferSearchCategories({ texto_original: "Loja com armazém no centro" });
    expect(r.categorias).toEqual(["comercial_armazens"]);
  });

  it("texto livre a pedir só garagem passa a indecidivel/sem_sinal", () => {
    const r = inferSearchCategories({ texto_original: "Procuro uma garagem para comprar" });
    expect(r.categoria_origem).toBe("indecidivel");
    expect(r.motivo_indecidivel).toBe("sem_sinal");
  });
});

describe("withInferredCategories", () => {
  it("preserva o resto do criteria e escreve auditoria", () => {
    const out = withInferredCategories({ tipologia: "T3", budget_max: 300000 } as Record<string, unknown>);
    expect(out.budget_max).toBe(300000);
    expect(out.categoria_origem).toBe("tipologia");
    expect(out.categorias).toEqual(["casas_apartamentos"]);
  });

  it("indecidivel escreve categorias null", () => {
    const out = withInferredCategories({} as Record<string, unknown>);
    expect(out.categorias).toBeNull();
    expect(out.categoria_origem).toBe("indecidivel");
  });
});
