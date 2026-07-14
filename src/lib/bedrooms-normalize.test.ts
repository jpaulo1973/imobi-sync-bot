import { describe, expect, it } from "vitest";
import {
  MAX_PLAUSIBLE_BEDROOMS,
  normalizeBedrooms,
  normalizeSearchBedrooms,
  sanitizeBedroomsCount,
} from "./bedrooms-normalize";

describe("normalizeBedrooms — formatos aceites", () => {
  const cases: Array<[unknown, string | null, number | null]> = [
    ["T3", "T3", 3],
    ["t3", "T3", 3],
    ["T 3", "T3", 3],
    ["T3+", "T3", 3],
    ["3", "T3", 3],
    ["3 quartos", "T3", 3],
    ["3 quarto", "T3", 3],
    ["3 assoalhadas", "T3", 3],
    ["5+", "T5", 5],
    [3, "T3", 3],
    ["Moradia", "Moradia", null],
    ["moradia", "Moradia", null],
    [null, null, null],
    [undefined, null, null],
    ["", null, null],
    ["texto qualquer", null, null],
  ];
  for (const [input, tip, q] of cases) {
    it(`${JSON.stringify(input)} → { tipologia:${JSON.stringify(tip)}, quartos_min:${q} }`, () => {
      expect(normalizeBedrooms(input)).toEqual({ tipologia: tip, quartos_min: q });
    });
  }
});

describe("normalizeBedrooms — valores implausíveis viram null", () => {
  it("'73' (bug clássico: 'T3' interpretado como número puro) → { null, null }", () => {
    expect(normalizeBedrooms("73")).toEqual({ tipologia: null, quartos_min: null });
  });
  it("'T73' → { null, null }", () => {
    expect(normalizeBedrooms("T73")).toEqual({ tipologia: null, quartos_min: null });
  });
  it(`quartos > ${MAX_PLAUSIBLE_BEDROOMS} → { null, null }`, () => {
    expect(normalizeBedrooms("999 quartos")).toEqual({ tipologia: null, quartos_min: null });
  });
});

describe("normalizeBedrooms — múltiplas tipologias", () => {
  it("'T2 ou T3' → tipologia preservada, quartos_min = 2", () => {
    expect(normalizeBedrooms("T2 ou T3")).toEqual({ tipologia: "T2 OU T3", quartos_min: 2 });
  });
  it("'T1/T2' → quartos_min = 1", () => {
    expect(normalizeBedrooms("T1/T2").quartos_min).toBe(1);
  });
});

describe("normalizeSearchBedrooms — reconciliação tipologia + quartos_min", () => {
  it("quartos_min explícito plausível prevalece", () => {
    expect(normalizeSearchBedrooms({ tipologia: "T2", quartos_min: 4 })).toEqual({
      tipologia: "T2",
      quartos_min: 4,
    });
  });
  it("quartos_min implausível é descartado, fica pelo derivado da tipologia", () => {
    expect(normalizeSearchBedrooms({ tipologia: "T3", quartos_min: 73 })).toEqual({
      tipologia: "T3",
      quartos_min: 3,
    });
  });
  it("sem tipologia e sem quartos_min → tudo null", () => {
    expect(normalizeSearchBedrooms({})).toEqual({ tipologia: null, quartos_min: null });
  });
  it("input do bug real (finalidade=Arrendamento, tipologia='73') não produz 73", () => {
    const out = normalizeSearchBedrooms({ tipologia: "73", quartos_min: 73 });
    expect(out.quartos_min).toBeNull();
    expect(out.tipologia).toBeNull();
  });
});

describe("sanitizeBedroomsCount — defesa do motor de matching", () => {
  it("valores válidos passam", () => {
    expect(sanitizeBedroomsCount(3)).toBe(3);
    expect(sanitizeBedroomsCount("5")).toBe(5);
  });
  it("valores implausíveis viram null (nunca 73)", () => {
    expect(sanitizeBedroomsCount(73)).toBeNull();
    expect(sanitizeBedroomsCount(999)).toBeNull();
  });
  it("null/vazio/negativo → null", () => {
    expect(sanitizeBedroomsCount(null)).toBeNull();
    expect(sanitizeBedroomsCount(0)).toBeNull();
    expect(sanitizeBedroomsCount(-1)).toBeNull();
  });
});