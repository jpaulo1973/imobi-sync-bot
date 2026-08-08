import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Destino de navegação já resolvido no servidor: aponta para o par
 * (comprador ↔ imóvel), não para a aba genérica.
 */
export type MatchNotificationTarget =
  | { to: "/imoveis"; search: { open: string; match: string } }
  | { to: "/clientes"; search: { buyer: string; property: string } };

export type MatchNotification = {
  id: string;
  buyer_source: "cliente" | "search";
  buyer_ref: string;
  property_id: string;
  buyer_label: string | null;
  property_label: string | null;
  score: number;
  reason_summary: string | null;
  read_at: string | null;
  created_at: string;
  target: MatchNotificationTarget;
};

/**
 * A chave usada nos cartões de match é `${source}-${id}` (ver
 * property-match.functions.ts), pelo que o par guardado na notificação
 * mapeia directamente para o cartão a destacar.
 */
export function matchCardKey(buyerSource: "cliente" | "search", buyerRef: string): string {
  return `${buyerSource}-${buyerRef}`;
}

export function notificationTarget(args: {
  buyer_source: "cliente" | "search";
  buyer_ref: string;
  property_id: string;
  ownsProperty: boolean;
}): MatchNotificationTarget {
  // Comprador próprio (cliente) sem posse do imóvel → abre o drawer do cliente
  // com o imóvel destacado. Nos restantes casos abre o match do imóvel.
  if (!args.ownsProperty && args.buyer_source === "cliente") {
    return { to: "/clientes", search: { buyer: args.buyer_ref, property: args.property_id } };
  }
  return {
    to: "/imoveis",
    search: { open: args.property_id, match: matchCardKey(args.buyer_source, args.buyer_ref) },
  };
}

/**
 * Varredura idempotente: cria notificações apenas para pares (cliente+imóvel)
 * que ainda não foram notificados a este consultor. Os matches continuam a ser
 * calculados na hora — nada é persistido além da notificação.
 */
export const sweepMatchNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sweepForUser } = await import("./match-notifications.server");
    const { rows, evaluated, candidates } = await sweepForUser(supabaseAdmin, userId);
    if (rows.length === 0) return { created: 0, evaluated, candidates };

    // A unicidade (user_id, pair_key) faz o trabalho: pares já notificados
    // são ignorados em vez de duplicados.
    const { data, error } = await supabaseAdmin
      .from("match_notifications")
      .upsert(rows, { onConflict: "user_id,pair_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    return { created: (data ?? []).length, evaluated, candidates };
  });

export const listMatchNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("match_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const propIds = Array.from(new Set(rows.map((r: any) => r.property_id as string)));
    const ownProps = new Set<string>();
    if (propIds.length > 0) {
      const { data: mine } = await supabase
        .from("properties")
        .select("id")
        .eq("user_id", userId)
        .in("id", propIds);
      for (const p of mine ?? []) ownProps.add((p as any).id as string);
    }
    const items: MatchNotification[] = rows.map((r: any) => ({
      id: r.id,
      buyer_source: r.buyer_source,
      buyer_ref: r.buyer_ref,
      property_id: r.property_id,
      buyer_label: r.buyer_label,
      property_label: r.property_label,
      score: r.score,
      reason_summary: r.reason_summary,
      read_at: r.read_at,
      created_at: r.created_at,
      target: notificationTarget({
        buyer_source: r.buyer_source,
        buyer_ref: r.buyer_ref,
        property_id: r.property_id,
        ownsProperty: ownProps.has(r.property_id as string),
      }),
    }));
    const unread = items.filter((i) => i.read_at == null).length;
    return { items, unread };
  });

export const countUnreadMatchNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { count, error } = await supabase
      .from("match_notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { unread: count ?? 0 };
  });

export const markMatchNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("match_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id)
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markAllMatchNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("match_notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
