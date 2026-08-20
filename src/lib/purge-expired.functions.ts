// Release 1.2.6 — Limpeza definitiva de procuras expiradas (Excel + WhatsApp).
//
// Toda a lógica corre no RPC SECURITY DEFINER admin-gated
// `admin_purge_expired_searches`, com modo simular (p_apply = false) e
// aplicar (p_apply = true). ATENÇÃO: aplicar é um DELETE irreversível.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PurgeExpiredResult = {
  aplicado: boolean;
  dias: number;
  elegiveis: number;
  apagadas: number;
  notificacoes_removidas: number;
  estados_removidos: number;
  oportunidades_removidas: number;
  por_origem: Array<{ origem: string; total: number }>;
  distribuicao: Array<{ mes: string; total: number }>;
  amostra: Array<{
    id: string;
    nome: string | null;
    origem: string;
    publicacao: string | null;
    expiracao: string | null;
  }>;
};

export const purgeExpiredSearches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ apply: z.boolean().default(false), dias: z.number().int().min(0).default(0) })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<PurgeExpiredResult> => {
    const { data: res, error } = await context.supabase.rpc("admin_purge_expired_searches", {
      p_apply: data.apply,
      p_dias: data.dias,
    });
    if (error) throw new Error(error.message);
    return res as PurgeExpiredResult;
  });

export type PurgeRunSummary = {
  executado_em: string;
  via: string;
  dias: number;
  elegiveis: number;
  apagadas: number;
  notificacoes_removidas: number;
  estados_removidos: number;
  oportunidades_removidas: number;
  por_origem?: Array<{ origem: string; total: number }>;
};

export type PurgeHistory = (PurgeRunSummary & { historico?: PurgeRunSummary[] }) | Record<string, never>;

/** Histórico das execuções (manuais e automáticas) — app_settings/purge_expired_last_run. */
export const getPurgeExpiredHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PurgeHistory> => {
    const { data, error } = await context.supabase.rpc("admin_purge_expired_history");
    if (error) throw new Error(error.message);
    return (data ?? {}) as PurgeHistory;
  });
