// Item 1 — guard único de administrador para server functions.
// Centraliza a verificação para que nenhuma função privilegiada dependa
// apenas do gate de rota (que só protege a UI, não o endpoint RPC).

export type AdminGuardContext = { supabase: any; userId: string };

export async function isAdminContext(context: AdminGuardContext): Promise<boolean> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

export async function assertAdminContext(context: AdminGuardContext): Promise<void> {
  if (!(await isAdminContext(context))) {
    throw new Error("Sem permissões de administrador.");
  }
}
