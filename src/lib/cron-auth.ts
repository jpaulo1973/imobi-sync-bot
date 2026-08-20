// Release 1.2.7 — Autenticação por segredo dos endpoints /api/public/cron/*.
//
// Não há sessão nestes endpoints: a única barreira é um segredo em header.
// Lógica pura e testável, separada do handler HTTP.

/** Segredos aceites, por ordem de preferência, a partir do ambiente do servidor. */
export function cronSecretsFromEnv(env: Record<string, string | undefined>): string[] {
  const candidatos = [
    env["SUPABASE_ANON_KEY"],
    env["SUPABASE_PUBLISHABLE_KEY"],
    env["VITE_SUPABASE_PUBLISHABLE_KEY"],
  ];
  const out: string[] = [];
  for (const c of candidatos) {
    const v = (c ?? "").trim();
    if (v.length >= 20 && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Extrai o segredo do pedido (`apikey` ou `Authorization: Bearer …`). */
export function providedSecret(headers: {
  get(name: string): string | null;
}): string | null {
  const direto = headers.get("apikey")?.trim();
  if (direto) return direto;
  const bearer = headers.get("authorization")?.trim();
  if (bearer) {
    const m = /^Bearer\s+(.+)$/i.exec(bearer);
    return (m?.[1] ?? bearer).trim() || null;
  }
  return null;
}

/** Comparação em tempo constante (evita distinguir segredos por timing). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type CronAuthResult =
  | { ok: true }
  | { ok: false; reason: "sem_segredo_configurado" | "sem_segredo_no_pedido" | "segredo_invalido" };

/** Autoriza o pedido. Falha fechada: sem segredo configurado, ninguém entra. */
export function authorizeCronRequest(
  headers: { get(name: string): string | null },
  env: Record<string, string | undefined>,
): CronAuthResult {
  const aceites = cronSecretsFromEnv(env);
  if (aceites.length === 0) return { ok: false, reason: "sem_segredo_configurado" };
  const provided = providedSecret(headers);
  if (!provided) return { ok: false, reason: "sem_segredo_no_pedido" };
  if (!aceites.some((s) => timingSafeEqual(s, provided))) {
    return { ok: false, reason: "segredo_invalido" };
  }
  return { ok: true };
}
