// Release 1.2.5 — Expiração das procuras.
//
// Regra única: uma procura vale 30 dias a contar da data em que foi
// PUBLICADA (mensagem original), não da data em que foi importada.
// Base, por ordem de preferência:
//   1. data_publicacao (timestamp completo)
//   2. data_origem (apenas data, do ficheiro)
//   3. nenhuma → fallback do caller (comportamento antigo: agora + 30 dias)
export const DURATION_DAYS = 30;
const DURATION_MS = DURATION_DAYS * 24 * 60 * 60 * 1000;

export type ExpiryBaseInput = {
  data_publicacao?: string | null;
  data_origem?: string | null;
};

/** Devolve o instante base (ISO) ou null se não houver data conhecida. */
export function expiryBase(input: ExpiryBaseInput): string | null {
  const pub = (input.data_publicacao ?? "").trim();
  if (pub) {
    const t = Date.parse(pub);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  const orig = (input.data_origem ?? "").trim();
  if (orig) {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(orig) ? `${orig}T00:00:00.000Z` : orig;
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

/** expires_at derivado da base, ou null se não houver base. */
export function expiresFromBase(input: ExpiryBaseInput): string | null {
  const base = expiryBase(input);
  if (!base) return null;
  return new Date(Date.parse(base) + DURATION_MS).toISOString();
}

/**
 * expires_at final: base + 30 dias quando existe data conhecida, caso
 * contrário o fallback do caller (por omissão, agora + 30 dias).
 */
export function computeExpiresAt(input: ExpiryBaseInput, fallback?: string | null): string {
  return (
    expiresFromBase(input) ??
    (fallback && fallback.trim() ? fallback : new Date(Date.now() + DURATION_MS).toISOString())
  );
}
