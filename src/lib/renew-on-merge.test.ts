import { describe, it, expect } from "vitest";
import { shouldRenewOnMerge, renewalPatch, computeBatchKey } from "./import-batch";
import { DURATION_DAYS } from "./expiry";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

describe("shouldRenewOnMerge — gatilho é o LOTE, nunca a linha", () => {
  it("lote genuinamente novo renova (excel)", () => {
    const d = shouldRenewOnMerge({ origem: "excel", batchKey: KEY_A, batchFresh: true });
    expect(d.renew).toBe(true);
    expect(d.reason).toBe("lote_novo");
  });

  it("lote novo renova (whatsapp)", () => {
    expect(shouldRenewOnMerge({ origem: "whatsapp", batchKey: KEY_A, batchFresh: true }).renew).toBe(true);
  });

  it("mesmo ficheiro reprocessado (lote já conhecido) NÃO renova", () => {
    const d = shouldRenewOnMerge({ origem: "excel", batchKey: KEY_A, batchFresh: false });
    expect(d.renew).toBe(false);
    expect(d.reason).toBe("lote_ja_conhecido");
  });

  it("mesma procura já renovada por este lote NÃO renova outra vez", () => {
    const d = shouldRenewOnMerge({
      origem: "excel",
      batchKey: KEY_A,
      batchFresh: true,
      existingRenewedByBatchKey: KEY_A,
    });
    expect(d.renew).toBe(false);
    expect(d.reason).toBe("ja_renovada_por_este_lote");
  });

  it("procura renovada por OUTRO lote pode renovar com um lote novo", () => {
    expect(
      shouldRenewOnMerge({
        origem: "excel",
        batchKey: KEY_B,
        batchFresh: true,
        existingRenewedByBatchKey: KEY_A,
      }).renew,
    ).toBe(true);
  });

  it("origem cliente NUNCA renova, mesmo com lote novo", () => {
    for (const origem of ["cliente", "texto", "captura", "", null, undefined]) {
      const d = shouldRenewOnMerge({ origem: origem as any, batchKey: KEY_A, batchFresh: true });
      expect(d.renew).toBe(false);
      expect(d.reason.startsWith("origem_nao_renovavel")).toBe(true);
    }
  });

  it("sem batch_key não renova (fusão manual/legacy)", () => {
    expect(shouldRenewOnMerge({ origem: "excel", batchKey: null, batchFresh: true }).reason).toBe("sem_batch_key");
    expect(shouldRenewOnMerge({ origem: "excel", batchKey: "  ", batchFresh: true }).renew).toBe(false);
  });
});

describe("renewalPatch", () => {
  it("data_publicacao passa a agora e expires_at = +30 dias", () => {
    const now = new Date("2026-08-20T10:00:00.000Z");
    const p = renewalPatch(KEY_A, now);
    expect(p.data_publicacao).toBe(now.toISOString());
    expect(Date.parse(p.expires_at) - now.getTime()).toBe(DURATION_DAYS * 24 * 3600 * 1000);
    expect(p.renewed_by_batch_key).toBe(KEY_A);
    expect(p.renewed_at).toBe(now.toISOString());
  });
});

describe("computeBatchKey", () => {
  it("mesmo conteúdo + mesmo user => mesma chave (reimportar não parece novo)", async () => {
    const a = await computeBatchKey("conteudo-base64", "user-1");
    const b = await computeBatchKey("conteudo-base64", "user-1");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("conteúdo diferente ou user diferente => chave diferente", async () => {
    const base = await computeBatchKey("conteudo-1", "user-1");
    expect(await computeBatchKey("conteudo-2", "user-1")).not.toBe(base);
    expect(await computeBatchKey("conteudo-1", "user-2")).not.toBe(base);
  });
});
