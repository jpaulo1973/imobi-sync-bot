import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scoreMatch } from "./matching-engine";

export const runPropertyMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ propertyId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const [{ data: property, error: pErr }, { data: buyers, error: bErr }] = await Promise.all([
      supabase.from("properties").select("*").eq("id", data.propertyId).eq("user_id", userId).maybeSingle(),
      supabase.from("buyer_clients").select("*").eq("user_id", userId).eq("ativo", true),
    ]);
    if (pErr) throw new Error(pErr.message);
    if (bErr) throw new Error(bErr.message);
    if (!property) throw new Error("Imóvel não encontrado.");

    const scored = (buyers ?? []).map((b) => ({ buyer: b, ...scoreMatch(b, property) }));
    const catOk = (m: (typeof scored)[number], key: string) =>
      m.categories.find((c) => c.key === key)?.ok ? 1 : 0;
    const matches = scored
      .filter((m) => m.compatible)
      .sort((a, b) => {
        // Ordem: localização OK → preço OK → tipologia OK → score → id
        const dl = catOk(b, "localizacao") - catOk(a, "localizacao");
        if (dl) return dl;
        const dp = catOk(b, "preco") - catOk(a, "preco");
        if (dp) return dp;
        const dt = catOk(b, "tipologia") - catOk(a, "tipologia");
        if (dt) return dt;
        return b.score - a.score;
      })
      .slice(0, 50)
      .map(({ buyer, score, reasons, categories }) => ({ buyer, score, reasons, categories }));

    return { matches, totalBuyers: (buyers ?? []).length };
  });

// Conta os compradores compatíveis para TODOS os imóveis do utilizador,
// numa única chamada. Rápido em memória mesmo com milhares de compradores.
export const countPropertyMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: properties, error: pErr }, { data: buyers, error: bErr }] = await Promise.all([
      supabase.from("properties").select("*").eq("user_id", userId).eq("ativo", true),
      supabase.from("buyer_clients").select("*").eq("user_id", userId).eq("ativo", true),
    ]);
    if (pErr) throw new Error(pErr.message);
    if (bErr) throw new Error(bErr.message);

    const counts: Record<string, number> = {};
    for (const p of properties ?? []) {
      let n = 0;
      for (const b of buyers ?? []) {
        if (scoreMatch(b, p).compatible) n++;
      }
      counts[p.id] = n;
    }
    return { counts, totalBuyers: (buyers ?? []).length };
  });
