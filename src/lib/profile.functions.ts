import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;

    const [{ data: profile }, { data: roles }, propsRes, buyersRes, oppsRes] =
      await Promise.all([
        supabase.from("profiles").select("full_name, agency").eq("id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("properties").select("id", { count: "exact", head: true }).eq("user_id", userId),
        supabase.from("buyer_clients").select("id", { count: "exact", head: true }).eq("user_id", userId),
        supabase
          .from("match_opportunities")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
      ]);

    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    // last_sign_in_at is on auth.users — read via admin client
    let lastSignInAt: string | null = null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
      lastSignInAt = data.user?.last_sign_in_at ?? null;
    } catch {}

    return {
      userId,
      email: (claims as any)?.email ?? null,
      fullName: profile?.full_name ?? null,
      agency: profile?.agency ?? null,
      role: isAdmin ? ("admin" as const) : ("consultor" as const),
      lastSignInAt,
      counts: {
        properties: propsRes.count ?? 0,
        buyers: buyersRes.count ?? 0,
        opportunities: oppsRes.count ?? 0,
      },
    };
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        fullName: z.string().trim().max(120).nullable().optional(),
        agency: z.string().trim().max(120).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.fullName !== undefined) patch.full_name = data.fullName || null;
    if (data.agency !== undefined) patch.agency = data.agency || null;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("profiles")
      .upsert({ id: context.userId, ...patch }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });