import { describe, it, expect } from "vitest";
import { registerImportBatch, readImportBatch } from "./import-batch-registry";

function fakeSupabase(opts: { rpcTimesSeen?: unknown; rpcError?: string; timesSeen?: number | null; selectError?: string }) {
  return {
    rpc: async () =>
      opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: opts.rpcTimesSeen, error: null },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            opts.selectError
              ? { data: null, error: { message: opts.selectError } }
              : { data: opts.timesSeen == null ? null : { times_seen: opts.timesSeen }, error: null },
        }),
      }),
    }),
  } as any;
}

const KEY = "f".repeat(64);

describe("registerImportBatch — novidade do lote decidida pela BD (times_seen)", () => {
  it("primeira vez que o ficheiro é registado (times_seen=1) => renovável", async () => {
    const r = await registerImportBatch(fakeSupabase({ rpcTimesSeen: 1 }), { batchKey: KEY, origem: "excel" });
    expect(r).toEqual({ batchKey: KEY, timesSeen: 1, renewable: true });
  });

  it("reimportar o MESMO ficheiro (times_seen=2) => não renovável, mesmo logo a seguir", async () => {
    const r = await registerImportBatch(fakeSupabase({ rpcTimesSeen: 2 }), { batchKey: KEY, origem: "excel" });
    expect(r).toEqual({ batchKey: KEY, timesSeen: 2, renewable: false });
  });

  it("falha do registo => falha fechada (não renova)", async () => {
    const r = await registerImportBatch(fakeSupabase({ rpcError: "boom" }), { batchKey: KEY, origem: "excel" });
    expect(r).toEqual({ batchKey: KEY, timesSeen: 0, renewable: false });
  });

  it("resposta inválida da RPC => falha fechada", async () => {
    const r = await registerImportBatch(fakeSupabase({ rpcTimesSeen: null }), { batchKey: KEY, origem: "excel" });
    expect(r.renewable).toBe(false);
  });

  it("batch_key vazio => sem registo e sem renovação", async () => {
    const r = await registerImportBatch(fakeSupabase({ rpcTimesSeen: 1 }), { batchKey: "  ", origem: "excel" });
    expect(r).toEqual({ batchKey: "", timesSeen: 0, renewable: false });
  });
});

describe("readImportBatch — leitura sem incrementar (chunks e leads)", () => {
  it("times_seen=1 => todos os chunks do MESMO upload renovam", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await readImportBatch(fakeSupabase({ timesSeen: 1 }), KEY);
      expect(r).toEqual({ batchKey: KEY, timesSeen: 1, renewable: true });
    }
  });

  it("times_seen=2 => nenhum chunk da reimportação renova", async () => {
    const r = await readImportBatch(fakeSupabase({ timesSeen: 2 }), KEY);
    expect(r.renewable).toBe(false);
  });

  it("lote inexistente => não renova", async () => {
    const r = await readImportBatch(fakeSupabase({ timesSeen: null }), KEY);
    expect(r).toEqual({ batchKey: KEY, timesSeen: 0, renewable: false });
  });

  it("erro de leitura => falha fechada", async () => {
    const r = await readImportBatch(fakeSupabase({ selectError: "boom" }), KEY);
    expect(r.renewable).toBe(false);
  });
});
