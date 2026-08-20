import { describe, expect, it } from "vitest";
import {
  PURGEABLE_ORIGINS,
  isPurgeEligible,
  isPurgeableOrigin,
  normalizePurgeDays,
} from "./purge-expired";

const now = new Date("2026-08-20T08:00:00.000Z");
const ontem = "2026-08-19T08:00:00.000Z";
const antigo = "2025-08-19T08:00:00.000Z";
const futuro = "2026-09-19T08:00:00.000Z";

describe("purge-expired — lista branca de origens", () => {
  it("apenas excel e whatsapp são purgáveis", () => {
    expect([...PURGEABLE_ORIGINS]).toEqual(["excel", "whatsapp"]);
    expect(isPurgeableOrigin("excel")).toBe(true);
    expect(isPurgeableOrigin("whatsapp")).toBe(true);
  });

  it("origem cliente nunca é apanhada", () => {
    expect(isPurgeableOrigin("cliente")).toBe(false);
    expect(isPurgeEligible({ origem: "cliente", expires_at: antigo }, { now })).toBe(false);
  });

  it("outras origens da app também ficam de fora", () => {
    for (const o of ["texto", "captura", "revisao", "import", "", null, undefined]) {
      expect(isPurgeEligible({ origem: o as string | null, expires_at: antigo }, { now })).toBe(false);
    }
  });
});

describe("purge-expired — janela temporal", () => {
  it("com dias = 0 apaga assim que expira", () => {
    expect(isPurgeEligible({ origem: "excel", expires_at: ontem }, { now })).toBe(true);
  });

  it("procura ainda válida nunca é elegível", () => {
    expect(isPurgeEligible({ origem: "excel", expires_at: futuro }, { now })).toBe(false);
  });

  it("margem em dias adia a elegibilidade", () => {
    expect(isPurgeEligible({ origem: "excel", expires_at: ontem }, { now, dias: 30 })).toBe(false);
    expect(isPurgeEligible({ origem: "excel", expires_at: antigo }, { now, dias: 30 })).toBe(true);
  });

  it("sem expires_at não é elegível", () => {
    expect(isPurgeEligible({ origem: "excel", expires_at: null }, { now })).toBe(false);
  });

  it("normaliza dias inválidos para 0", () => {
    expect(normalizePurgeDays(undefined)).toBe(0);
    expect(normalizePurgeDays(-5)).toBe(0);
    expect(normalizePurgeDays(2.7)).toBe(2);
  });
});
