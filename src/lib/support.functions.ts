import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SupportRequest = {
  id: string;
  user_id: string;
  autor_nome: string | null;
  autor_email: string | null;
  mensagem: string;
  read_at: string | null;
  created_at: string;
};

// Envio de email ao Admin fica preparado mas desligado: ainda não existe
// domínio de email configurado. Quando existir, basta ligar esta flag.
const EMAIL_TO_ADMIN_ENABLED = false;

export const submitSupportRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        mensagem: z
          .string()
          .trim()
          .min(10, "Escreva pelo menos 10 caracteres.")
          .max(2000, "Máximo 2000 caracteres."),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const email = ((claims as any)?.email as string | undefined) ?? null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();

    const { error } = await supabase.from("support_requests").insert({
      user_id: userId,
      autor_nome: (profile as any)?.full_name ?? null,
      autor_email: email,
      mensagem: data.mensagem,
    });
    if (error) throw new Error(error.message);

    if (EMAIL_TO_ADMIN_ENABLED) {
      // Reservado: notificação por email ao Admin (requer domínio configurado).
    }
    return { ok: true, emailed: false };
  });

export const listSupportRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // A RLS garante que só o próprio autor ou um admin vê cada linha.
    const { data, error } = await context.supabase
      .from("support_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const items = (data ?? []) as SupportRequest[];
    return { items, unread: items.filter((i) => i.read_at == null).length };
  });

export const markSupportRequestRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("support_requests")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });