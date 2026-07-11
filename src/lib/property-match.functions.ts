import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scoreMatch, type BuyerLike, type MatchCategoryResult } from "./matching-engine";
import { loadZoneContext } from "./functional-zones";
import { loadConsultorMeta } from "./opportunity-privacy";

// ---------------------------------------------------------------------------
// Release 1.2 — Property Opportunities
//
// Fonte única de oportunidades para a página do imóvel. Une três fontes:
//   1) Compradores registados (buyer_clients — pessoais do consultor)
//   2) Procuras importadas por Excel (active_searches, origem="excel")
//   3) Procuras importadas por WhatsApp (active_searches, origem="whatsapp"/"texto"/"captura")
//
// active_searches é Base Global: os consultores não vêem a lista completa,
// mas beneficiam da inteligência ao ver as oportunidades cruzadas com os
// seus imóveis. Por isso lemos active_searches via supabaseAdmin depois de
// confirmar (via RLS) que o utilizador é dono do imóvel.
// ---------------------------------------------------------------------------

export type OpportunitySource = "cliente" | "excel" | "whatsapp" | "texto" | "captura";

export type Opportunity = {
  key: string; // origem-id, para reactkey
  source: OpportunitySource;
  score: number;
  reasons: string[];
  categories: MatchCategoryResult[];
  nome: string | null;
  telefone: string | null;
  email: string | null;
  finalidade: string | null;
  tipologia: string | null;
  zona: string | null;
  budget_min: number | null;
  budget_max: number | null;
  consultor_nome: string | null;
  consultor_telefone: string | null;
  data_origem: string | null;
  hora_origem: string | null;
  grupo_whatsapp: string | null;
  comunidade: string | null;
  resumo: string | null;
  created_at: string | null;
};

function criteriaToBuyer(c: any): BuyerLike {
  const finalidade = c?.finalidade === "indefinido" ? undefined : c?.finalidade;
  const gar = ((c?.caracteristicas ?? []) as string[]).some((x) => /garagem/i.test(x));
  const ele = ((c?.caracteristicas ?? []) as string[]).some((x) => /elevador/i.test(x));
  return {
    finalidade,
    tipo_imovel: c?.tipo_imovel ?? null,
    tipologia: c?.tipologia ?? null,
    zona: c?.zona ?? c?.municipio ?? c?.freguesia ?? null,
    freguesia: c?.freguesia ?? null,
    municipio: c?.municipio ?? null,
    budget_min: c?.budget_min ?? null,
    budget_max: c?.budget_max ?? null,
    area_min: c?.area_min ?? null,
    quartos_min: c?.quartos_min ?? null,
    garagem_obrigatoria: gar,
    elevador_obrigatorio: ele,
    proximity: c?.proximity ?? null,
  };
}

export const runPropertyOpportunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ propertyId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: property, error: pErr } = await supabase
      .from("properties")
      .select("*")
      .eq("id", data.propertyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!property) throw new Error("Imóvel não encontrado.");

    const { data: buyers } = await supabase
      .from("buyer_clients")
      .select("*")
      .eq("user_id", userId)
      .eq("ativo", true);

    // Base Global: active_searches via admin, filtradas ao vivo apenas para
    // esta property. Não expomos a lista completa ao consultor.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nowIso = new Date().toISOString();
    const { data: searches } = await supabaseAdmin
      .from("active_searches")
      .select("*")
      .gt("expires_at", nowIso);

    const zoneContext = await loadZoneContext();
    // Consultor meta para procuras de OUTROS consultores (Privacy Layer).
    const otherUserIds = Array.from(
      new Set(
        (searches ?? [])
          .filter((q: any) => q.user_id && q.user_id !== userId)
          .map((q: any) => q.user_id as string),
      ),
    );
    const consultorMap = await loadConsultorMeta(otherUserIds);

    const opps: Opportunity[] = [];

    for (const b of buyers ?? []) {
      const s = scoreMatch(b as BuyerLike, property as any, { zoneContext });
      if (!s.compatible) continue;
      opps.push({
        key: `cliente-${b.id}`,
        source: "cliente",
        score: s.score,
        reasons: s.reasons,
        categories: s.categories,
        nome: b.nome ?? null,
        telefone: b.telefone ?? null,
        email: b.email ?? null,
        finalidade: (b.finalidade as string) ?? null,
        tipologia: b.tipologia ?? null,
        zona: b.zona ?? null,
        budget_min: b.budget_min != null ? Number(b.budget_min) : null,
        budget_max: b.budget_max != null ? Number(b.budget_max) : null,
        consultor_nome: null,
        consultor_telefone: null,
        data_origem: null,
        hora_origem: null,
        grupo_whatsapp: null,
        comunidade: null,
        resumo: b.notas ?? null,
        created_at: b.created_at ?? null,
      });
    }

    for (const q of searches ?? []) {
      const buyer = criteriaToBuyer(q.criteria);
      const s = scoreMatch(buyer, property as any, { zoneContext });
      if (!s.compatible) continue;
      const c = (q.criteria ?? {}) as any;
      const origem = (q.origem as OpportunitySource) ?? "excel";
      const isOwner = q.user_id === userId;
      const consultor = !isOwner ? consultorMap.get(q.user_id) ?? null : null;
      opps.push({
        key: `search-${q.id}`,
        source: origem,
        score: s.score,
        reasons: s.reasons,
        categories: s.categories,
        // Privacy Layer: PII do comprador só é devolvida ao dono da procura.
        nome: isOwner ? q.contact_nome ?? c?.nome ?? null : null,
        telefone: isOwner ? q.contact_telefone ?? null : null,
        email: isOwner ? q.contact_email ?? null : null,
        finalidade: c?.finalidade ?? null,
        tipologia: c?.tipologia ?? null,
        zona: c?.zona ?? c?.municipio ?? c?.freguesia ?? null,
        budget_min: c?.budget_min ?? null,
        budget_max: c?.budget_max ?? null,
        consultor_nome: consultor?.nome ?? q.consultor_nome ?? null,
        consultor_telefone: consultor?.telefone ?? q.consultor_telefone ?? null,
        data_origem: q.data_origem ?? null,
        hora_origem: q.hora_origem ?? null,
        grupo_whatsapp: q.grupo_whatsapp ?? q.contact_grupo ?? null,
        comunidade: q.comunidade ?? null,
        resumo: q.resumo ?? null,
        created_at: q.created_at ?? null,
      });
    }

    opps.sort((a, b) => b.score - a.score);

    return {
      opportunities: opps.slice(0, 100),
      totalBuyers: (buyers ?? []).length,
      totalGlobal: (searches ?? []).length,
    };
  });

// Contagem por imóvel — Base Global unificada. Usado para os cards.
export const countPropertyOpportunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: properties }, { data: buyers }] = await Promise.all([
      supabase.from("properties").select("*").eq("user_id", userId).eq("ativo", true),
      supabase.from("buyer_clients").select("*").eq("user_id", userId).eq("ativo", true),
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: searches } = await supabaseAdmin
      .from("active_searches")
      .select("id, criteria, origem, expires_at")
      .gt("expires_at", new Date().toISOString());

    const zoneContext = await loadZoneContext();
    const counts: Record<string, number> = {};
    for (const p of properties ?? []) {
      let n = 0;
      for (const b of buyers ?? []) {
        if (scoreMatch(b as BuyerLike, p as any, { zoneContext }).compatible) n++;
      }
      for (const q of searches ?? []) {
        if (scoreMatch(criteriaToBuyer(q.criteria), p as any, { zoneContext }).compatible) n++;
      }
      counts[p.id] = n;
    }
    return {
      counts,
      totalBuyers: (buyers ?? []).length,
      totalGlobal: (searches ?? []).length,
    };
  });

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

    const zoneContext = await loadZoneContext();
    const scored = (buyers ?? []).map((b) => ({ buyer: b, ...scoreMatch(b, property, { zoneContext }) }));
    const catOk = (m: (typeof scored)[number], key: string) =>
      m.categories.find((c) => c.key === key)?.ok ? 1 : 0;
    const matches = scored
      .filter((m) => m.compatible)
      .sort((a, b) => {
        // Todos os matches passaram nos Hard Filters. Ordena por score final,
        // depois por localização (nível mais próximo → mais alto).
        if (b.score !== a.score) return b.score - a.score;
        return catOk(b, "localizacao") - catOk(a, "localizacao");
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

    const zoneContext = await loadZoneContext();
    const counts: Record<string, number> = {};
    for (const p of properties ?? []) {
      let n = 0;
      for (const b of buyers ?? []) {
        if (scoreMatch(b, p, { zoneContext }).compatible) n++;
      }
      counts[p.id] = n;
    }
    return { counts, totalBuyers: (buyers ?? []).length };
  });
