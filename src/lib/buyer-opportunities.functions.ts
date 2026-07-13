import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scoreMatch, type BuyerLike, type MatchCategoryResult } from "./matching-engine";
import { loadZoneContext } from "./functional-zones";
import {
  loadConsultorMeta,
  sanitizePropertyForViewer,
  type PropertyDTO,
} from "./opportunity-privacy";

// ---------------------------------------------------------------------------
// Release 1.2 — Vista do Consultor do Comprador.
//
// Espelho de property-match.functions.ts, mas do outro lado: dado UM buyer
// do consultor, devolve imóveis compatíveis de toda a Base Global. O buyer
// é lido via RLS (só o dono acede). Os imóveis vêm via supabaseAdmin, mas
// só saem daqui após passarem pelo Privacy Layer.
// ---------------------------------------------------------------------------

function buyerToBuyerLike(b: any): BuyerLike {
  return {
    finalidade: b.finalidade ?? null,
    tipo_imovel: b.tipo_imovel ?? null,
    tipologia: b.tipologia ?? null,
    zona: b.zona ?? null,
    freguesia: null,
    municipio: null,
    budget_min: b.budget_min ?? null,
    budget_max: b.budget_max ?? null,
    area_min: b.area_min ?? null,
    quartos_min: b.quartos_min ?? null,
    garagem_obrigatoria: b.garagem_obrigatoria ?? null,
    elevador_obrigatorio: b.elevador_obrigatorio ?? null,
    proximity: b.proximity ?? null,
  };
}

export type BuyerPropertyMatch = PropertyDTO & {
  score: number;
  reasons: string[];
  categories: MatchCategoryResult[];
};

export const runBuyerOpportunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ buyerId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1) Ler buyer via RLS — garante posse do próprio consultor.
    const { data: buyer, error: bErr } = await supabase
      .from("buyer_clients")
      .select("*")
      .eq("id", data.buyerId)
      .eq("user_id", userId)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!buyer) throw new Error("Comprador não encontrado.");

    // 2) Carregar imóveis da base global via admin.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: properties } = await supabaseAdmin
      .from("properties")
      .select("*")
      .eq("ativo", true);

    const zoneContext = await loadZoneContext();
    const buyerLike = buyerToBuyerLike(buyer);

    // 3) Pré-carregar meta dos consultores angariadores de imóveis externos.
    const otherUserIds = Array.from(
      new Set(
        (properties ?? [])
          .filter((p: any) => p.user_id && p.user_id !== userId)
          .map((p: any) => p.user_id as string),
      ),
    );
    const consultorMap = await loadConsultorMeta(otherUserIds);

    // 4) Correr motor + Hard Filters 1.2.1.
    const matches: BuyerPropertyMatch[] = [];
    for (const p of properties ?? []) {
      const r = scoreMatch(buyerLike, p as any, { zoneContext });
      if (!r.compatible || r.score < 60) continue;
      const isOwner = (p as any).user_id === userId;
      const consultor = !isOwner ? consultorMap.get((p as any).user_id) ?? null : null;
      const dto = sanitizePropertyForViewer(p, userId, consultor);
      matches.push({ ...dto, score: r.score, reasons: r.reasons, categories: r.categories });
    }
    matches.sort((a, b) => b.score - a.score);
    return { matches: matches.slice(0, 100), totalGlobal: (properties ?? []).length };
  });

/**
 * Contagem de imóveis compatíveis por buyer (usado nas badges de `clientes.tsx`).
 */
export const countBuyerOpportunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: buyers } = await supabase
      .from("buyer_clients")
      .select("*")
      .eq("user_id", userId)
      .eq("ativo", true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: properties } = await supabaseAdmin
      .from("properties")
      .select("id, user_id, tipo_imovel, tipologia, distrito, concelho, freguesia, zona, preco, area_util_m2, area_m2, area_terreno_m2, quartos, garagem, elevador, jardim, piscina, finalidade")
      .eq("ativo", true);
    const zoneContext = await loadZoneContext();
    const counts: Record<string, number> = {};
    for (const b of buyers ?? []) {
      let n = 0;
      const bl = buyerToBuyerLike(b);
      for (const p of properties ?? []) {
        if (scoreMatch(bl, p as any, { zoneContext }).compatible) n++;
      }
      counts[b.id] = n;
    }
    return { counts, totalGlobal: (properties ?? []).length };
  });