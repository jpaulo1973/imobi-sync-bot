import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminContext } from "@/lib/admin-guard.server";

export type SupportReply = {
  id: string;
  request_id: string;
  author_id: string;
  mensagem: string;
  created_at: string;
};

export type SupportRequest = {
  id: string;
  user_id: string;
  autor_nome: string | null;
  autor_email: string | null;
  mensagem: string;
  read_at: string | null;
  created_at: string;
  status: string;
  arquivado: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  replies?: SupportReply[];
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
  .inputValidator((data: unknown) =>
    z
      .object({ arquivados: z.boolean().optional() })
      .optional()
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const arquivados = data?.arquivados === true;
    // A RLS garante que só o próprio autor ou um admin vê cada linha.
    const { data: rows, error } = await context.supabase
      .from("support_requests")
      .select("*")
      .eq("arquivado", arquivados)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const items = (rows ?? []) as SupportRequest[];
    if (items.length > 0) {
      const { data: replies, error: rErr } = await context.supabase
        .from("support_replies")
        .select("*")
        .in(
          "request_id",
          items.map((i) => i.id),
        )
        .order("created_at", { ascending: true });
      if (rErr) throw new Error(rErr.message);
      const byRequest = new Map<string, SupportReply[]>();
      for (const r of (replies ?? []) as SupportReply[]) {
        const list = byRequest.get(r.request_id) ?? [];
        list.push(r);
        byRequest.set(r.request_id, list);
      }
      for (const i of items) i.replies = byRequest.get(i.id) ?? [];
    }
    return {
      items,
      unread: items.filter((i) => i.read_at == null).length,
      abertos: items.filter((i) => i.status !== "resolvido").length,
    };
  });

/** Item 3 — histórico do próprio consultor (mensagens + respostas do admin). */
export const listMySupportRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("support_requests")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const items = (data ?? []) as SupportRequest[];
    if (items.length > 0) {
      const { data: replies, error: rErr } = await context.supabase
        .from("support_replies")
        .select("*")
        .in(
          "request_id",
          items.map((i) => i.id),
        )
        .order("created_at", { ascending: true });
      if (rErr) throw new Error(rErr.message);
      for (const i of items)
        i.replies = ((replies ?? []) as SupportReply[]).filter((r) => r.request_id === i.id);
    }
    return { items };
  });

/** Item 3 — resposta do administrador a um pedido. */
export const replyToSupportRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        mensagem: z.string().trim().min(2, "Escreva uma resposta.").max(2000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdminContext(context);
    const { error } = await context.supabase.from("support_replies").insert({
      request_id: data.id,
      author_id: context.userId,
      mensagem: data.mensagem,
    });
    if (error) throw new Error(error.message);
    // Responder implica ter lido.
    await context.supabase
      .from("support_requests")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id)
      .is("read_at", null);
    return { ok: true };
  });

/** Item 3 — marcar resolvido e arquivar (substitui eliminação). */
export const resolveAndArchiveSupportRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), arquivar: z.boolean().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdminContext(context);
    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("support_requests")
      .update({
        status: "resolvido",
        arquivado: data.arquivar !== false,
        resolved_at: now,
        resolved_by: context.userId,
        read_at: now,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Item 3 — reabrir um pedido arquivado por engano. */
export const reopenSupportRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminContext(context);
    const { error } = await context.supabase
      .from("support_requests")
      .update({ status: "aberto", arquivado: false, resolved_at: null, resolved_by: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
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