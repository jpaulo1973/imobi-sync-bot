// Release 1.2.6 — Limpeza definitiva de procuras expiradas.
//
// DELETE real: não existe soft-delete, lixeira nem tabela de recuperação.
// Se o comprador continuar à procura, reaparece nos grupos e é reimportado.
//
// Regra de segurança: lista BRANCA de origens. Nunca por exclusão — assim
// qualquer origem futura (cliente, texto, captura, revisão, …) fica fora
// do alcance da limpeza por omissão.
export const PURGEABLE_ORIGINS = ["excel", "whatsapp"] as const;
export type PurgeableOrigin = (typeof PURGEABLE_ORIGINS)[number];

/** Origem elegível para apagamento definitivo? */
export function isPurgeableOrigin(origem: string | null | undefined): boolean {
  return !!origem && (PURGEABLE_ORIGINS as readonly string[]).includes(origem);
}

/** Dias de margem após a expiração. Default 0 = apaga assim que expira. */
export function normalizePurgeDays(dias?: number | null): number {
  const n = Number(dias ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/** Elegibilidade (mesma regra que o RPC), usada nos testes de regressão. */
export function isPurgeEligible(
  row: { origem: string | null; expires_at: string | null },
  opts?: { dias?: number; now?: Date },
): boolean {
  if (!isPurgeableOrigin(row.origem)) return false;
  if (!row.expires_at) return false;
  const t = Date.parse(row.expires_at);
  if (Number.isNaN(t)) return false;
  const now = (opts?.now ?? new Date()).getTime();
  const limite = now - normalizePurgeDays(opts?.dias) * 24 * 60 * 60 * 1000;
  return t <= limite;
}
