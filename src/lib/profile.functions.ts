import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Item 2 — campos obrigatórios em falta, para o alerta na primeira entrada.
export type ProfileMissingField = "fullName" | "telefone" | "agency" | "whatsapp";

export function computeMissingProfileFields(p: {
  fullName?: string | null;
  telefone?: string | null;
  agency?: string | null;
  whatsapp?: string | null;
}): ProfileMissingField[] {
  const missing: ProfileMissingField[] = [];
  const empty = (v: string | null | undefined) => !v || v.trim().length < 2;
  if (empty(p.fullName)) missing.push("fullName");
  if (empty(p.telefone)) missing.push("telefone");
  if (empty(p.agency)) missing.push("agency");
  if (empty(p.whatsapp)) missing.push("whatsapp");
  return missing;
}

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;

    const [{ data: profile }, { data: roles }, propsRes, buyersRes, oppsRes] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, agency, telefone, whatsapp, ami, ativo")
          .eq("id", userId)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("properties").select("id", { count: "exact", head: true }).eq("user_id", userId),
        supabase.from("buyer_clients").select("id", { count: "exact", head: true }).eq("user_id", userId),
        supabase
          .from("match_opportunities")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
      ]);

    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    // last_sign_in_at vive em auth.users e só é legível com service_role, que
    // não existe em todos os hosts. Usamos o claim do token quando presente.
    const iat = (claims as any)?.iat as number | undefined;
    const lastSignInAt = typeof iat === "number" ? new Date(iat * 1000).toISOString() : null;

    const missingFields = computeMissingProfileFields({
      fullName: profile?.full_name ?? null,
      agency: profile?.agency ?? null,
      telefone: (profile as any)?.telefone ?? null,
      whatsapp: (profile as any)?.whatsapp ?? null,
    });

    return {
      userId,
      email: (claims as any)?.email ?? null,
      fullName: profile?.full_name ?? null,
      agency: profile?.agency ?? null,
      telefone: (profile as any)?.telefone ?? null,
      whatsapp: (profile as any)?.whatsapp ?? null,
      ami: (profile as any)?.ami ?? null,
      missingFields,
      // Contas novas nascem inativas: só `true` explícito dá acesso.
      ativo: (profile as any)?.ativo === true,
      role: isAdmin ? ("admin" as const) : ("consultor" as const),
      lastSignInAt,
      counts: {
        properties: propsRes.count ?? 0,
        buyers: buyersRes.count ?? 0,
        opportunities: oppsRes.count ?? 0,
      },
    };
  });

// Campos obrigatórios do perfil do consultor: nome, telemóvel, agência e
// WhatsApp. AMI é opcional. O email vem da autenticação (não editável).
const phone = z
  .string()
  .trim()
  .min(9, "Número inválido (mínimo 9 dígitos).")
  .max(40)
  .refine((v) => v.replace(/\D+/g, "").length >= 9, "Número inválido (mínimo 9 dígitos).");

export const profileFormSchema = z.object({
  fullName: z.string().trim().min(2, "Indique o nome.").max(120),
  agency: z.string().trim().min(2, "Indique a agência.").max(120),
  telefone: phone,
  whatsapp: phone,
  ami: z.string().trim().max(40).optional().or(z.literal("")),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => profileFormSchema.parse(data))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {
      full_name: data.fullName,
      agency: data.agency,
      telefone: data.telefone,
      whatsapp: data.whatsapp,
      ami: data.ami?.trim() ? data.ami.trim() : null,
    };
    const { error } = await context.supabase
      .from("profiles")
      .upsert({ id: context.userId, ...patch }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });