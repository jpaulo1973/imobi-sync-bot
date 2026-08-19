import { describe, expect, it } from "vitest";
import { DURATION_DAYS, computeExpiresAt, expiresFromBase, expiryBase } from "./expiry";

const DAY = 24 * 60 * 60 * 1000;

describe("expiry", () => {
  it("usa data_publicacao + 30 dias, não a data de importação", () => {
    const exp = expiresFromBase({ data_publicacao: "2026-06-21T10:30:00.000Z" });
    expect(exp).toBe(new Date(Date.parse("2026-06-21T10:30:00.000Z") + DURATION_DAYS * DAY).toISOString());
  });

  it("cai para data_origem quando não há data_publicacao", () => {
    expect(expiryBase({ data_origem: "2026-07-01" })).toBe("2026-07-01T00:00:00.000Z");
    expect(expiresFromBase({ data_publicacao: null, data_origem: "2026-07-01" })).toBe(
      new Date(Date.parse("2026-07-01T00:00:00.000Z") + DURATION_DAYS * DAY).toISOString(),
    );
  });

  it("sem qualquer data mantém o comportamento atual (fallback do caller)", () => {
    expect(expiresFromBase({})).toBeNull();
    const fallback = "2026-09-30T00:00:00.000Z";
    expect(computeExpiresAt({ data_publicacao: null, data_origem: null }, fallback)).toBe(fallback);
  });

  it("é idempotente: reimportar a mesma linha devolve o mesmo expires_at", () => {
    const row = { data_publicacao: "2026-06-21T10:30:00.000Z", data_origem: "2026-06-21" };
    const a = computeExpiresAt(row, new Date().toISOString());
    const b = computeExpiresAt(row, new Date(Date.now() + 5 * DAY).toISOString());
    expect(a).toBe(b);
  });

  it("ignora datas inválidas", () => {
    expect(expiryBase({ data_publicacao: "não é data" })).toBeNull();
  });
});

// Regra da fusão (mergeInto): expires_at deriva sempre da base conhecida;
// sem base, mantém a expiração já gravada — reimportar não estende.
function mergedExpires(existing: any, row: any): string {
  return (
    expiresFromBase({
      data_publicacao: row.data_publicacao ?? existing.data_publicacao ?? null,
      data_origem: row.data_origem ?? existing.data_origem ?? null,
    }) ?? existing.expires_at ?? row.expires_at
  );
}

describe("expiração na reimportação", () => {
  it("reimportar o mesmo ficheiro não estende expires_at", () => {
    const existing = { data_publicacao: "2026-06-21T10:00:00.000Z", expires_at: "2026-07-21T10:00:00.000Z" };
    const row = { data_publicacao: "2026-06-21T10:00:00.000Z", expires_at: new Date().toISOString() };
    expect(mergedExpires(existing, row)).toBe("2026-07-21T10:00:00.000Z");
  });

  it("sem data conhecida mantém a expiração gravada", () => {
    const existing = { expires_at: "2026-07-21T10:00:00.000Z" };
    const row = { expires_at: "2026-12-01T00:00:00.000Z" };
    expect(mergedExpires(existing, row)).toBe("2026-07-21T10:00:00.000Z");
  });
});
