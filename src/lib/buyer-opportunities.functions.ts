import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  scoreMatch,
  evaluateExhaustive,
  buildGeoMatchIndex,
  type BuyerLike,
  type MatchCategoryResult,
  type AuditCategoryResult,
  type ShortCircuit,
  type RejectReason,
} from "./matching-engine";
import { LocationRepository } from "./geo";
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
    location_ids: Array.isArray(b.location_ids) ? (b.location_ids as string[]) : [],
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

    const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());
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
    let analyzed = 0;
    const rejections: Record<RejectReason, number> = {
      FINALIDADE: 0, TIPO_IMOVEL: 0, INVESTIDOR_BULK: 0, LOCALIZACAO: 0,
      AREA: 0, CARACTERISTICAS: 0, ORCAMENTO: 0, TIPOLOGIA: 0,
    };
    for (const p of properties ?? []) {
      analyzed++;
      const r = scoreMatch(buyerLike, p as any, { geoIndex });
      if (!r.compatible) {
        if (r.rejectReason) rejections[r.rejectReason]++;
        continue;
      }
      if (r.score < 60) continue;
      const isOwner = (p as any).user_id === userId;
      const consultor = !isOwner ? consultorMap.get((p as any).user_id) ?? null : null;
      const dto = sanitizePropertyForViewer(p, userId, consultor);
      matches.push({ ...dto, score: r.score, reasons: r.reasons, categories: r.categories });
    }
    matches.sort((a, b) => b.score - a.score);
    return {
      matches: matches.slice(0, 100),
      totalGlobal: (properties ?? []).length,
      analyzed,
      rejections,
    };
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
      .select("id, user_id, tipo_imovel, tipologia, distrito, concelho, freguesia, zona, preco, area_util_m2, area_m2, area_terreno_m2, quartos, garagem, elevador, jardim, piscina, finalidade, location_id")
      .eq("ativo", true);
    const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());
    const counts: Record<string, number> = {};
    for (const b of buyers ?? []) {
      let n = 0;
      const bl = buyerToBuyerLike(b);
      for (const p of properties ?? []) {
        if (scoreMatch(bl, p as any, { geoIndex }).compatible) n++;
      }
      counts[b.id] = n;
    }
    return { counts, totalGlobal: (properties ?? []).length };
  });

// ---------------------------------------------------------------------------
// Sprint 1.2.1 — Auditoria Completa do Motor Match (lado do comprador)
// ---------------------------------------------------------------------------

export type BuyerAuditCandidate = {
  key: string; // property.id
  property_id: string;
  isOwner: boolean;
  label: string;
  referencia: string | null;
  tipo_imovel: string | null;
  tipologia: string | null;
  preco: number | null;
  compatible: boolean;
  score: number;
  rejectReason: RejectReason | null;
  shortCircuitAt: ShortCircuit | null;
  passedCount: number;
  failedCount: number;
  categories: AuditCategoryResult[];
  consultor_nome: string | null;
  consultor_telefone: string | null;
  consultor_email: string | null;
  consultor_agency: string | null;
};

export const auditBuyerMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ buyerId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: buyer, error: bErr } = await supabase
      .from("buyer_clients")
      .select("*")
      .eq("id", data.buyerId)
      .eq("user_id", userId)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!buyer) throw new Error("Comprador não encontrado.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: properties } = await supabaseAdmin
      .from("properties")
      .select("*")
      .eq("ativo", true);

    const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());
    const buyerLike = buyerToBuyerLike(buyer);

    const otherUserIds = Array.from(
      new Set(
        (properties ?? [])
          .filter((p: any) => p.user_id && p.user_id !== userId)
          .map((p: any) => p.user_id as string),
      ),
    );
    const consultorMap = await loadConsultorMeta(otherUserIds);

    const candidates: BuyerAuditCandidate[] = [];
    for (const p of properties ?? []) {
      const r = evaluateExhaustive(buyerLike, p as any, { geoIndex });
      const isOwner = (p as any).user_id === userId;
      const consultor = !isOwner ? consultorMap.get((p as any).user_id) ?? null : null;
      const dto = sanitizePropertyForViewer(p, userId, consultor);
      candidates.push({
        key: p.id,
        property_id: p.id,
        isOwner,
        label: `${dto.tipologia ? dto.tipologia + " · " : ""}${dto.freguesia ?? dto.concelho ?? dto.zona ?? "Imóvel"}`,
        referencia: dto.referencia ?? null,
        tipo_imovel: dto.tipo_imovel ?? null,
        tipologia: dto.tipologia ?? null,
        preco: dto.preco != null ? Number(dto.preco) : null,
        compatible: r.compatible,
        score: r.score,
        rejectReason: r.rejectReason,
        shortCircuitAt: r.shortCircuitAt,
        passedCount: r.passedCount,
        failedCount: r.failedCount,
        categories: r.categories,
        consultor_nome: dto.consultor_nome ?? null,
        consultor_telefone: dto.consultor_telefone ?? null,
        consultor_email: dto.consultor_email ?? null,
        consultor_agency: (dto as any).consultor_agency ?? null,
      });
    }

    candidates.sort((a, b) => {
      if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
      if (a.compatible) return b.score - a.score;
      if (b.passedCount !== a.passedCount) return b.passedCount - a.passedCount;
      return b.score - a.score;
    });

    const compat = candidates.filter((c) => c.compatible).length;
    return {
      candidates,
      totals: {
        total: candidates.length,
        compatible: compat,
        rejected: candidates.length - compat,
        properties: (properties ?? []).length,
      },
    };
  });