import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scoreMatch, type BuyerLike, type MatchCategoryResult } from "./matching-engine";
import { buildGeoMatchIndex, type RejectReason } from "./matching-engine";
import { LocationRepository } from "./geo";
import { loadConsultorMeta, loadConsultorDirectory, resolveConsultor } from "./opportunity-privacy";

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
  consultor_email: string | null;
  consultor_agency: string | null;
  data_origem: string | null;
  hora_origem: string | null;
  grupo_whatsapp: string | null;
  comunidade: string | null;
  resumo: string | null;
  created_at: string | null;
  // Release 1.3 — identificação do par para gestão de estado.
  buyer_source: "cliente" | "search";
  buyer_ref: string;
  state: "novo" | "contactado" | "nao_interessado";
  // Release 1.3 — o consumidor precisa de distinguir procuras próprias
  // (mostra o comprador) de externas (mostra o consultor responsável).
  isOwner: boolean;
};

function criteriaToBuyer(c: any, location_ids: string[] = []): BuyerLike {
  const finalidade = c?.finalidade === "indefinido" ? undefined : c?.finalidade;
  const gar = ((c?.caracteristicas ?? []) as string[]).some((x) => /garagem/i.test(x));
  const ele = ((c?.caracteristicas ?? []) as string[]).some((x) => /elevador/i.test(x));
  return {
    finalidade,
    tipo_imovel: c?.tipo_imovel ?? null,
    tipologia: c?.tipologia ?? null,
    location_ids,
    budget_min: c?.budget_min ?? null,
    budget_max: c?.budget_max ?? null,
    area_min: c?.area_min ?? null,
    quartos_min: c?.quartos_min ?? null,
    garagem_obrigatoria: gar,
    elevador_obrigatorio: ele,
    proximity: c?.proximity ?? null,
    caracteristicas: Array.isArray(c?.caracteristicas) ? c.caracteristicas : null,
  };
}

export const runPropertyOpportunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        propertyId: z.string().uuid(),
        includeDismissed: z.boolean().optional().default(false),
      })
      .parse(data),
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

    const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());
    // Consultor meta para procuras de OUTROS consultores (Privacy Layer).
    const otherUserIds = Array.from(
      new Set(
        (searches ?? [])
          .filter((q: any) => q.user_id && q.user_id !== userId)
          .map((q: any) => q.user_id as string),
      ),
    );
    const [consultorMap, consultorDirectory] = await Promise.all([
      loadConsultorMeta(otherUserIds),
      loadConsultorDirectory(),
    ]);

    // Estados por par para este imóvel.
    const { data: stateRows } = await supabase
      .from("match_states")
      .select("buyer_source, buyer_ref, state")
      .eq("user_id", userId)
      .eq("property_id", data.propertyId);
    const stateMap = new Map<string, "novo" | "contactado" | "nao_interessado">();
    for (const s of stateRows ?? []) {
      stateMap.set(`${(s as any).buyer_source}-${(s as any).buyer_ref}`, (s as any).state);
    }

    const opps: Opportunity[] = [];
    let hiddenCount = 0;
    let analyzed = 0;
    const rejections: Record<RejectReason, number> = {
      FINALIDADE: 0, TIPO_IMOVEL: 0, INVESTIDOR_BULK: 0, LOCALIZACAO: 0,
      AREA: 0, CARACTERISTICAS: 0, ORCAMENTO: 0, TIPOLOGIA: 0,
    };

    for (const b of buyers ?? []) {
      analyzed++;
      const s = scoreMatch(b as BuyerLike, property as any, { geoIndex });
      if (!s.compatible) {
        if (s.rejectReason) rejections[s.rejectReason]++;
        continue;
      }
      const state = stateMap.get(`cliente-${b.id}`) ?? "novo";
      if (state === "nao_interessado" && !data.includeDismissed) {
        hiddenCount++;
        continue;
      }
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
        consultor_email: null,
        consultor_agency: null,
        data_origem: null,
        hora_origem: null,
        grupo_whatsapp: null,
        comunidade: null,
        resumo: b.notas ?? null,
        created_at: b.created_at ?? null,
        buyer_source: "cliente",
        buyer_ref: b.id,
        state,
        isOwner: true,
      });
    }

    for (const q of searches ?? []) {
      analyzed++;
      const buyer = criteriaToBuyer(q.criteria, (q as any).location_ids ?? []);
      buyer.resumo = q.resumo ?? null;
      buyer.texto_original = (q as any).texto_original ?? null;
      const s = scoreMatch(buyer, property as any, { geoIndex });
      if (!s.compatible) {
        if (s.rejectReason) rejections[s.rejectReason]++;
        continue;
      }
      const c = (q.criteria ?? {}) as any;
      const origem = (q.origem as OpportunitySource) ?? "excel";
      const isOwner = q.user_id === userId;
      const uploaderMeta = !isOwner ? consultorMap.get(q.user_id) ?? null : null;
      const state = stateMap.get(`search-${q.id}`) ?? "novo";
      if (state === "nao_interessado" && !data.includeDismissed) {
        hiddenCount++;
        continue;
      }
      // Consultor por-registo tem prioridade sobre a meta do dono do upload.
      // Excel/WhatsApp guardam consultor_nome/telefone em cada linha; o
      // uploader não é necessariamente o consultor responsável pela procura.
      // Resolvemos email/agência procurando o consultor na diretoria global
      // (profiles + auth users) por nome/telefone normalizados.
      const recNome =
        typeof q.consultor_nome === "string" && q.consultor_nome.trim()
          ? q.consultor_nome.trim()
          : null;
      const recTelefone =
        typeof q.consultor_telefone === "string" && q.consultor_telefone.trim()
          ? q.consultor_telefone.trim()
          : null;
      // Correções finais 1.3: NUNCA usar o dono do upload como consultor.
      // Se o registo não trouxer consultor explícito, tentamos usar o
      // contacto principal (contact_nome/telefone) apenas para procuras
      // importadas por Excel — nesses ficheiros a coluna "Nome" contém
      // habitualmente o consultor responsável, não o comprador. Nunca cai
      // para o uploader (ADMJP…), que não é o consultor da procura.
      const origemLower = (q.origem ?? "").toString().toLowerCase();
      const isExcel = origemLower === "excel";
      const fallbackNome = isExcel
        ? (typeof q.contact_nome === "string" && q.contact_nome.trim()
            ? q.contact_nome.trim()
            : null)
        : null;
      const fallbackTelefone = isExcel
        ? (typeof q.contact_telefone === "string" && q.contact_telefone.trim()
            ? q.contact_telefone.trim()
            : null)
        : null;
      void uploaderMeta; // intencional: já não é usado como consultor
      const resolved = resolveConsultor(
        consultorDirectory,
        recNome ?? fallbackNome,
        recTelefone ?? fallbackTelefone,
        null,
      );
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
        consultor_nome: resolved.nome,
        consultor_telefone: resolved.telefone,
        consultor_email: resolved.email,
        consultor_agency: resolved.agency,
        data_origem: q.data_origem ?? null,
        hora_origem: q.hora_origem ?? null,
        grupo_whatsapp: q.grupo_whatsapp ?? q.contact_grupo ?? null,
        comunidade: q.comunidade ?? null,
        resumo: q.resumo ?? null,
        created_at: q.created_at ?? null,
        buyer_source: "search",
        buyer_ref: q.id,
        state,
        isOwner,
      });
    }

    opps.sort((a, b) => b.score - a.score);

    return {
      opportunities: opps.slice(0, 100),
      totalBuyers: (buyers ?? []).length,
      totalGlobal: (searches ?? []).length,
      hiddenCount,
      analyzed,
      rejections,
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
      .select("id, criteria, origem, expires_at, resumo, texto_original, location_ids")
      .gt("expires_at", new Date().toISOString());

    const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());
    // Estados marcados como 'nao_interessado' — filtrados da contagem.
    const { data: stateRows } = await supabase
      .from("match_states")
      .select("property_id, buyer_source, buyer_ref, state")
      .eq("user_id", userId)
      .eq("state", "nao_interessado");
    const dismissed = new Set<string>();
    for (const s of stateRows ?? []) {
      dismissed.add(`${(s as any).property_id}|${(s as any).buyer_source}-${(s as any).buyer_ref}`);
    }
    const counts: Record<string, number> = {};
    for (const p of properties ?? []) {
      let n = 0;
      for (const b of buyers ?? []) {
        if (
          scoreMatch(b as BuyerLike, p as any, { geoIndex }).compatible &&
          !dismissed.has(`${p.id}|cliente-${b.id}`)
        )
          n++;
      }
      for (const q of searches ?? []) {
        if (
          scoreMatch(
            {
              ...criteriaToBuyer(q.criteria, (q as any).location_ids ?? []),
              resumo: (q as any).resumo ?? null,
              texto_original: (q as any).texto_original ?? null,
            },
            p as any,
            { geoIndex },
          ).compatible &&
          !dismissed.has(`${p.id}|search-${q.id}`)
        )
          n++;
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

    const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());
    const scored = (buyers ?? []).map((b) => ({ buyer: b, ...scoreMatch(b, property, { geoIndex }) }));
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

    const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());
    const counts: Record<string, number> = {};
    for (const p of properties ?? []) {
      let n = 0;
      for (const b of buyers ?? []) {
        if (scoreMatch(b, p, { geoIndex }).compatible) n++;
      }
      counts[p.id] = n;
    }
    return { counts, totalBuyers: (buyers ?? []).length };
  });
