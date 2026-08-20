// Renovação de validade por LOTE NOVO (Release 1.2.7)
//
// Problema: reaparecer num ficheiro de importação novo é sinal de que o
// comprador continua ativo — a procura deve renovar (data_publicacao = hoje,
// expires_at recalculado). Mas reprocessar o MESMO ficheiro não pode renovar
// nada, senão volta o bug de estender validade indefinidamente.
//
// Solução: a identidade do lote é o CONTEÚDO do ficheiro/texto (SHA-256) +
// user_id — nunca o conteúdo de uma linha nem um timestamp de execução.
// O `batch_id` (timestamp) continua a servir só para controlo de execução.
import { expiresFromBase } from "./expiry";

/** Origens em que a renovação é permitida. Nunca "cliente"/"texto"/"captura". */
export const RENEWABLE_ORIGINS = ["excel", "whatsapp"] as const;

/** SHA-256 hex do conteúdo (base64 do ficheiro, ou texto colado). */
export async function computeBatchKey(content: string, userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${userId}::${content}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type RenewInput = {
  origem: string | null | undefined;
  batchKey?: string | null;
  /** true só quando este lote foi registado pela primeira vez agora (janela curta). */
  batchFresh?: boolean;
  /** batch_key que já renovou ESTA procura (idempotência por registo). */
  existingRenewedByBatchKey?: string | null;
};

export type RenewDecision = { renew: boolean; reason: string };

export function shouldRenewOnMerge(input: RenewInput): RenewDecision {
  const origem = (input.origem ?? "").trim();
  if (!(RENEWABLE_ORIGINS as readonly string[]).includes(origem)) {
    return { renew: false, reason: `origem_nao_renovavel:${origem || "vazia"}` };
  }
  const key = (input.batchKey ?? "").trim();
  if (!key) return { renew: false, reason: "sem_batch_key" };
  if (!input.batchFresh) return { renew: false, reason: "lote_ja_conhecido" };
  if ((input.existingRenewedByBatchKey ?? "").trim() === key) {
    return { renew: false, reason: "ja_renovada_por_este_lote" };
  }
  return { renew: true, reason: "lote_novo" };
}

/** Campos a gravar quando a renovação é permitida. */
export function renewalPatch(batchKey: string, now = new Date()): {
  data_publicacao: string;
  expires_at: string;
  renewed_by_batch_key: string;
  renewed_at: string;
} {
  const iso = now.toISOString();
  return {
    data_publicacao: iso,
    expires_at: expiresFromBase({ data_publicacao: iso })!,
    renewed_by_batch_key: batchKey,
    renewed_at: iso,
  };
}
