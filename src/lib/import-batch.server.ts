// Registo server-side de lotes de importação. A "frescura" do lote é
// determinada pela BASE DE DADOS (first_seen_at), nunca por um sinal enviado
// pelo cliente — assim reprocessar o mesmo ficheiro mais tarde não pode
// renovar validades.
import { RENEWABLE_ORIGINS } from "./import-batch";

/** Janela em que um lote acabado de registar ainda é considerado "novo". */
export const FRESH_WINDOW_MS = 30 * 60 * 1000;

export type BatchTouch = { batchKey: string; isNew: boolean; fresh: boolean };

export async function touchImportBatch(
  supabase: any,
  args: { batchKey: string; origem: string; filename?: string | null },
): Promise<BatchTouch> {
  const batchKey = (args.batchKey ?? "").trim();
  const origem = (RENEWABLE_ORIGINS as readonly string[]).includes(args.origem) ? args.origem : "excel";
  if (!batchKey) return { batchKey: "", isNew: false, fresh: false };

  let isNew = false;
  try {
    const { data, error } = await supabase.rpc("import_batch_register", {
      p_batch_key: batchKey,
      p_origem: origem,
      p_filename: args.filename ?? null,
    });
    if (error) throw new Error(error.message);
    isNew = data === true;
  } catch (e) {
    console.error("[import-batch] register failed", e);
    // Falha fechada: sem registo fiável, não renovamos nada.
    return { batchKey, isNew: false, fresh: false };
  }

  let fresh = isNew;
  if (!isNew) {
    try {
      const { data } = await supabase
        .from("import_batches")
        .select("first_seen_at")
        .eq("batch_key", batchKey)
        .maybeSingle();
      const t = data?.first_seen_at ? Date.parse(data.first_seen_at) : NaN;
      fresh = Number.isFinite(t) && Date.now() - t <= FRESH_WINDOW_MS;
    } catch (e) {
      console.error("[import-batch] freshness check failed", e);
      fresh = false;
    }
  }
  return { batchKey, isNew, fresh };
}
