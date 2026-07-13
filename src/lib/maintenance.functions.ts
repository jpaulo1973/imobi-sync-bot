import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Release 1.3 — Modo de Manutenção.
// Singleton em app_settings (key='maintenance'). Leitura autenticada;
// escrita restrita a admins (via RLS `has_role`).

export type MaintenanceStatus = {
  enabled: boolean;
  message: string | null;
  updated_at: string | null;
};

export const getMaintenanceStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MaintenanceStatus> => {
    const { data, error } = await context.supabase
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", "maintenance")
      .maybeSingle();
    if (error) throw new Error(error.message);
    const v = ((data?.value ?? {}) as any) || {};
    return {
      enabled: !!v.enabled,
      message: v.message ?? null,
      updated_at: data?.updated_at ?? null,
    };
  });

export const setMaintenanceMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        message: z.string().trim().max(500).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    // Verifica admin antes de tentar escrever — mensagem de erro clara em vez
    // de um RLS denied opaco.
    const { data: role } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Sem permissões de administrador.");

    const payload = {
      enabled: !!data.enabled,
      message: data.message ?? null,
    };
    const { error } = await context.supabase
      .from("app_settings")
      .upsert(
        {
          key: "maintenance",
          value: payload,
          updated_by: context.userId,
        },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true, ...payload };
  });