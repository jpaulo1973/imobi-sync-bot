// Release 1.2.5 — Recálculo da expiração das procuras Excel.
//
// Toda a lógica corre num RPC SECURITY DEFINER admin-gated
// (`admin_recalc_excel_expiry`), que suporta simulação (dry-run) e
// aplicação. Nada é apagado nem descartado: só a data de validade muda.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ExpiryRecalcResult = {
  aplicado: boolean;
  afetadas: number;
  ficam_expiradas: number;
  sem_base: number;
  atualizadas: number;
  distribuicao: Array<{ mes: string; total: number }>;
  amostra: Array<{ id: string; nome: string | null; publicacao: string; exp_atual: string; exp_novo: string }>;
};

export const recalcExcelExpiry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ apply: z.boolean().default(false) }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<ExpiryRecalcResult> => {
    const { data: res, error } = await context.supabase.rpc("admin_recalc_excel_expiry", {
      p_apply: data.apply,
    });
    if (error) throw new Error(error.message);
    return res as ExpiryRecalcResult;
  });
