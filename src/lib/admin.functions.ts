import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sem permissões de administrador.");
}

export const isCurrentUserAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: !!data };
  });

export const listAppUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw new Error(error.message);
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, agency, ativo");
    const rolesByUser = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    });
    const profileById = new Map<string, any>();
    (profiles ?? []).forEach((p: any) => profileById.set(p.id, p));
    return {
      users: data.users.map((u) => {
        const p = profileById.get(u.id);
        const userRoles = rolesByUser.get(u.id) ?? [];
        return {
          id: u.id,
          email: u.email,
          full_name: (p?.full_name as string | null) ?? null,
          agency: (p?.agency as string | null) ?? null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          roles: userRoles,
          role: (userRoles.includes("admin") ? "admin" : "consultor") as "admin" | "consultor",
          ativo: p?.ativo !== false,
        };
      }),
    };
  });

export const setAppUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({ userId: z.string().uuid(), role: z.enum(["admin", "consultor"]) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId && data.role !== "admin") {
      throw new Error("Não pode remover as suas próprias permissões de administrador.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 'consultor' é representado pelo papel base 'user' na base de dados
    const dbRole = data.role === "admin" ? "admin" : "user";
    const { error: delError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId);
    if (delError) throw new Error(delError.message);
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: dbRole });
    if (error) throw new Error(error.message);
    return { ok: true, role: data.role };
  });

export const setAppUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ userId: z.string().uuid(), ativo: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId && !data.ativo) {
      throw new Error("Não pode desativar a sua própria conta.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ ativo: data.ativo })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    // Soft-delete reversível: bloqueia também o login sem apagar a conta.
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.ativo ? "none" : "876000h",
    });
    if (banError) throw new Error(banError.message);
    return { ok: true, ativo: data.ativo };
  });

export const createAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        isAdmin: z.boolean().optional().default(false),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    const role = data.isAdmin ? "admin" : "user";
    await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: created.user!.id, role });
    return { id: created.user!.id, email: created.user!.email };
  });

export const deleteAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("Não pode remover a sua própria conta.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });