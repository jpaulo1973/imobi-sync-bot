import { describe, expect, it } from "vitest";
import {
  DUPLICATE_SIM_THRESHOLD,
  groupTextSimilarity,
  shouldSuggestGroup,
} from "./duplicates.server";

// Regressão: limiar único de 0,80 para grupos por telefone e por nome.
describe("limiar de similaridade de duplicados", () => {
  it("usa 0,80 para telefone e nome", () => {
    expect(DUPLICATE_SIM_THRESHOLD).toBe(0.8);
    expect(shouldSuggestGroup("telefone", 0.8)).toBe(true);
    expect(shouldSuggestGroup("nome", 0.8)).toBe(true);
    expect(shouldSuggestGroup("telefone", 0.79)).toBe(false);
  });

  it("caso Isabel Santos (consultora, ~0,50) deixa de ser sugerido", () => {
    const textos = [
      "Procuro T2 em Matosinhos ate 250 mil euros com garagem",
      "Cliente quer T4 moradia em Gondomar ate 500 mil euros com jardim",
      "Compro apartamento T1 no Porto Baixa ate 180 mil para investimento",
    ];
    const sim = groupTextSimilarity(textos);
    expect(sim).toBeLessThan(0.8);
    expect(sim).toBeGreaterThan(0.2);
    expect(shouldSuggestGroup("telefone", sim)).toBe(false);
  });

  it("reimportação quase idêntica (>=0,80) continua a aparecer", () => {
    const textos = [
      "Procuro apartamento T3 em Antas Porto ate 400 mil euros com garagem e elevador",
      "Procuro apartamento T3 em Antas Porto ate 400 mil euros com garagem e elevador!",
    ];
    const sim = groupTextSimilarity(textos);
    expect(sim).toBeGreaterThanOrEqual(0.8);
    expect(shouldSuggestGroup("telefone", sim)).toBe(true);
  });

  it("textos idênticos dão similaridade 1", () => {
    expect(groupTextSimilarity(["mesmo texto", "mesmo texto"])).toBe(1);
  });
});
