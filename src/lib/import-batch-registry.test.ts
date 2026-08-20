import { describe, it, expect } from "vitest";
import { touchImportBatch, FRESH_WINDOW_MS } from "./import-batch-registry";

function fakeSupabase(opts: { isNew?: boolean; firstSeenAt?: string | null; rpcError?: string }) {
  return {
    rpc: async () =>
      opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: !!opts.isNew, error: null },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opts.firstSeenAt ? { first_seen_at: opts.firstSeenAt } : null }),
        }),
      }),
    }),
  } as any;
}

const KEY = "f".repeat(64);

describe("touchImportBatch — frescura decidida pela BD, nunca pelo cliente", () => {
  it("primeira vez que o ficheiro é visto => isNew e fresh", async () => {
    const r = await touchImportBatch(fakeSupabase({ isNew: true }), { batchKey: KEY, origem: "excel" });
    expect(r).toEqual({ batchKey: KEY, isNew: true, fresh: true });
  });

  it("ficheiro já registado há muito tempo => não fresh (reimportar não renova)", async () => {
    const old = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const r = await touchImportBatch(fakeSupabase({ isNew: false, firstSeenAt: old }), {
      batchKey: KEY,
      origem: "excel",
    });
    expect(r.fresh).toBe(false);
  });

  it("chunks seguintes do MESMO upload continuam fresh (janela curta)", async () => {
    const recent = new Date(Date.now() - FRESH_WINDOW_MS / 3).toISOString();
    const r = await touchImportBatch(fakeSupabase({ isNew: false, firstSeenAt: recent }), {
      batchKey: KEY,
      origem: "excel",
    });
    expect(r.fresh).toBe(true);
  });

  it("falha do registo => falha fechada (não renova)", async () => {
    const r = await touchImportBatch(fakeSupabase({ rpcError: "boom" }), { batchKey: KEY, origem: "excel" });
    expect(r).toEqual({ batchKey: KEY, isNew: false, fresh: false });
  });

  it("batch_key vazio => sem registo e sem renovação", async () => {
    const r = await touchImportBatch(fakeSupabase({ isNew: true }), { batchKey: "  ", origem: "excel" });
    expect(r).toEqual({ batchKey: "", isNew: false, fresh: false });
  });
});
