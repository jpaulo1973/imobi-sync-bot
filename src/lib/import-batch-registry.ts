// Registo server-side de lotes de importação (Release 1.2.7 — corrigido).
//
// Regra: um ficheiro/conversa é "lote novo" APENAS na primeira vez que é
// registado (times_seen == 1). Não existe janela temporal: reimportar o mesmo
// ficheiro 1 minuto depois é exatamente o mesmo lote e NÃO renova validades.
//
// Para isso o registo (incremento) acontece UMA só vez por upload — no
// arranque da importação — e os chunks seguintes apenas LEEM o estado.
import { RENEWABLE_ORIGINS } from "./import-batch";

export type BatchRegistration = { batchKey: string; timesSeen: number; renewable: boolean };

function normOrigem(origem: string): string {
  return (RENEWABLE_ORIGINS as readonly string[]).includes(origem) ? origem : "excel";
}

/**
 * Incrementa o contador do lote e devolve o número de vezes que este
 * ficheiro/conversa já foi visto. Chamar exatamente UMA vez por upload.
 */
export async function registerImportBatch(
  supabase: any,
  args: { batchKey: string; origem: string; filename?: string | null },
): Promise<BatchRegistration> {
  const batchKey = (args.batchKey ?? "").trim();
  if (!batchKey) return { batchKey: "", timesSeen: 0, renewable: false };
  try {
    const { data, error } = await supabase.rpc("import_batch_register", {
      p_batch_key: batchKey,
      p_origem: normOrigem(args.origem),
      p_filename: args.filename ?? null,
    });
    if (error) throw new Error(error.message);
    const timesSeen = Number(data);
    if (!Number.isFinite(timesSeen) || timesSeen < 1) throw new Error(`times_seen inválido: ${String(data)}`);
    return { batchKey, timesSeen, renewable: timesSeen === 1 };
  } catch (e) {
    console.error("[import-batch] register failed", e);
    // Falha fechada: sem registo fiável, não renovamos nada.
    return { batchKey, timesSeen: 0, renewable: false };
  }
}

/**
 * Lê o estado do lote sem o incrementar. Usado pelos chunks de uma importação
 * já registada: renovável só se este ficheiro nunca tinha sido visto antes.
 */
export async function readImportBatch(supabase: any, batchKey: string): Promise<BatchRegistration> {
  const key = (batchKey ?? "").trim();
  if (!key) return { batchKey: "", timesSeen: 0, renewable: false };
  try {
    const { data, error } = await supabase
      .from("import_batches")
      .select("times_seen")
      .eq("batch_key", key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const timesSeen = Number(data?.times_seen ?? 0);
    return { batchKey: key, timesSeen, renewable: timesSeen === 1 };
  } catch (e) {
    console.error("[import-batch] read failed", e);
    return { batchKey: key, timesSeen: 0, renewable: false };
  }
}
