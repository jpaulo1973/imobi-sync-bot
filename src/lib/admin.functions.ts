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
    // RPC SECURITY DEFINER: lista os consultores a partir de `profiles`
    // (email sincronizado no registo) + papéis. Não depende da service_role
    // key, pelo que funciona em qualquer host.
    const { data, error } = await context.supabase.rpc("admin_list_users");
    if (error) throw new Error(error.message);
    return {
      users: (data ?? []).map((u: any) => {
        const userRoles: string[] = (u.roles ?? []).filter(Boolean);
        return {
          id: u.id as string,
          email: (u.email as string | null) ?? null,
          full_name: (u.full_name as string | null) ?? null,
          agency: (u.agency as string | null) ?? null,
          created_at: u.created_at as string,
          // last_sign_in_at vive em auth.users (só com service_role).
          last_sign_in_at: null as string | null,
          roles: userRoles,
          role: (userRoles.includes("admin") ? "admin" : "consultor") as "admin" | "consultor",
          ativo: u.ativo !== false,
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
    // 'consultor' é representado pelo papel base 'user' na base de dados
    const dbRole = data.role === "admin" ? "admin" : "user";
    const { error } = await context.supabase.rpc("admin_set_user_role", {
      p_user_id: data.userId,
      p_role: dbRole,
    });
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
    // `profiles.ativo` é a fonte de verdade do acesso: a app bloqueia contas
    // inativas na sessão (ver perfil/gate). Escrita via política de admin.
    const { error } = await context.supabase
      .from("profiles")
      .update({ ativo: data.ativo })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
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
    // Criação sem service_role: registo normal (publishable key) num cliente
    // isolado, para não tocar na sessão do administrador.
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['SUPABASE_ANON_KEY'];
    if (!url || !key) throw new Error("Configuração do backend indisponível.");
    const signupClient = createClient(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data: created, error } = await signupClient.auth.signUp({
      email: data.email,
      password: data.password,
    });
    if (error) throw new Error(error.message);
    const newId = created.user?.id;
    if (!newId) throw new Error("Não foi possível criar a conta.");
    const role = data.isAdmin ? "admin" : "user";
    const { error: roleError } = await context.supabase.rpc("admin_set_user_role", {
      p_user_id: newId,
      p_role: role,
    });
    if (roleError) throw new Error(roleError.message);
    return { id: newId, email: created.user?.email ?? data.email };
  });

export const deleteAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("Não pode remover a sua própria conta.");
    }
    // Sem service_role não é possível apagar a linha de autenticação. O RPC
    // remove todos os dados do consultor e desativa a conta (soft-delete),
    // que é o efeito prático esperado na aplicação.
    const { error } = await context.supabase.rpc("admin_purge_user_data", {
      p_user_id: data.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });