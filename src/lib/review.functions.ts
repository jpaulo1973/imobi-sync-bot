import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recomputeForSearch } from "./active-searches.functions";
import { buildDedupKey } from "./dedup";
import { scoreMatch, type BuyerLike } from "./matching-engine";
import { normalizeGeoText } from "./geo";
import { loadConsultorDirectory, resolveConsultor } from "./opportunity-privacy";
import { normalizePhone } from "./dedup";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Apenas administradores.");
}

function completenessScore(row: any): number {
  const c = (row.criteria ?? {}) as any;
  let s = 0;
  if (row.contact_telefone) s += 3;
  if (c.finalidade && c.finalidade !== "indefinido") s += 2;
  if (c.tipologia) s += 2;
  if (Array.isArray(c.tipo_imovel) && c.tipo_imovel.length) s += 2;
  if (c.zona || c.freguesia || c.municipio) s += 3;
  if (c.budget_max) s += 2;
  if (c.budget_min) s += 1;
  if (c.area_min) s += 1;
  if (Array.isArray(c.caracteristicas) && c.caracteristicas.length) s += 1;
  if (row.texto_original && row.texto_original.length > 40) s += 1;
  return s;
}

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
  };
}

export const listPendingReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("active_searches")
      .select(
        "id, user_id, criteria, location_ids, resumo, texto_original, contact_nome, contact_telefone, contact_email, contact_grupo, consultor_nome, consultor_telefone, consultor_whatsapp, consultor_email, comunidade, grupo_whatsapp, origem, decision_reason, similarity_score, created_at, data_origem",
      )
      .eq("flagged_for_review", true)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

const CriteriaPatch = z.object({
  finalidade: z.enum(["venda", "arrendamento", "indefinido"]).optional(),
  tipo_imovel: z.array(z.string()).nullable().optional(),
  tipologia: z.string().nullable().optional(),
  zona: z.string().nullable().optional(),
  freguesia: z.string().nullable().optional(),
  municipio: z.string().nullable().optional(),
  distrito: z.string().nullable().optional(),
  budget_min: z.number().nullable().optional(),
  budget_max: z.number().nullable().optional(),
  area_min: z.number().nullable().optional(),
  quartos_min: z.number().nullable().optional(),
  caracteristicas: z.array(z.string()).nullable().optional(),
  nome: z.string().nullable().optional(),
});

export const updateReviewSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        id: z.string().uuid(),
        criteria: CriteriaPatch,
        contact_nome: z.string().nullable().optional(),
        contact_telefone: z.string().nullable().optional(),
        location_ids: z.array(z.string().uuid()).optional(),
        resolve: z.boolean().default(true),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: existing, error: gErr } = await supabase
      .from("active_searches")
      .select("id, user_id, criteria, contact_telefone, contact_nome, location_ids")
      .eq("id", data.id)
      .maybeSingle();
    if (gErr) throw new Error(gErr.message);
    if (!existing) throw new Error("Procura não encontrada.");
    const newCriteria = { ...(existing.criteria as any), ...data.criteria };
    const telefone = data.contact_telefone ?? existing.contact_telefone;
    const nome = data.contact_nome ?? existing.contact_nome;
    const dedup_key = buildDedupKey({
      telefone,
      nome,
      finalidade: (newCriteria.finalidade ?? "indefinido") as any,
      tipologia: newCriteria.tipologia ?? null,
      tipo_imovel: newCriteria.tipo_imovel ?? null,
      zona: newCriteria.zona ?? newCriteria.municipio ?? newCriteria.freguesia ?? null,
    });
    const patch: Record<string, unknown> = {
      criteria: newCriteria,
      contact_nome: nome,
      contact_telefone: telefone,
      dedup_key,
    };
    if (data.location_ids) patch.location_ids = data.location_ids;
    if (data.resolve) {
      patch.flagged_for_review = false;
      patch.decision_reason = "Revisto manualmente pelo administrador";
      // Correções 1.3: reintegrar coloca a procura imediatamente em produção.
      // Renovamos o TTL (30 dias) para que o Motor Match volte a considerá-la
      // e limpamos last_match_at para forçar reavaliação em novas contagens.
      patch.expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      patch.last_match_at = null;
    }
    const { error } = await supabase.from("active_searches").update(patch as any).eq("id", data.id);
    if (error) throw new Error(error.message);
    // Recruzar imediatamente.
    try {
      await recomputeForSearch(supabase, existing.user_id, data.id);
    } catch (e) {
      console.error("review recompute failed", e);
    }
    return { ok: true };
  });

export const deleteReviewSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase.from("active_searches").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Release 1.2 — Nova Revisão: apenas contactos do consultor são editáveis.
// Nome, telefone, WhatsApp e email do consultor podem ser adicionados ou
// corrigidos antes de reintegrar a procura. Todos os restantes campos são
// resolvidos automaticamente pelo motor.
const ConsultorPatch = z.object({
  id: z.string().uuid(),
  consultor_nome: z.string().trim().nullable().optional(),
  consultor_telefone: z.string().trim().nullable().optional(),
  consultor_whatsapp: z.string().trim().nullable().optional(),
  consultor_email: z.string().trim().email().nullable().optional(),
  resolve: z.boolean().default(true),
});

export const updateReviewConsultor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ConsultorPatch.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const patch: Record<string, unknown> = {};
    if (data.consultor_nome !== undefined) patch.consultor_nome = data.consultor_nome || null;
    if (data.consultor_telefone !== undefined) patch.consultor_telefone = data.consultor_telefone || null;
    if (data.consultor_whatsapp !== undefined) patch.consultor_whatsapp = data.consultor_whatsapp || null;
    if (data.consultor_email !== undefined) patch.consultor_email = data.consultor_email || null;
    if (data.resolve) {
      patch.flagged_for_review = false;
      patch.decision_reason = "Contactos do consultor revistos manualmente";
    }
    const { error } = await supabase
      .from("active_searches")
      .update(patch as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const SplitInput = z.object({
  id: z.string().uuid(),
  parts: z
    .array(
      CriteriaPatch.extend({
        location_ids: z.array(z.string().uuid()).optional(),
      }),
    )
    .min(1)
    .max(10),
});

export const splitReviewSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SplitInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: source, error: gErr } = await supabase
      .from("active_searches")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (gErr) throw new Error(gErr.message);
    if (!source) throw new Error("Procura não encontrada.");

    // A primeira parte substitui o registo original; as restantes viram novos registos.
    const createdIds: string[] = [];
    const [first, ...rest] = data.parts;
    const applyFirstCriteria = { ...(source.criteria as any), ...first };
    const firstDedup = buildDedupKey({
      telefone: source.contact_telefone,
      nome: source.contact_nome,
      finalidade: (applyFirstCriteria.finalidade ?? "indefinido") as any,
      tipologia: applyFirstCriteria.tipologia ?? null,
      tipo_imovel: applyFirstCriteria.tipo_imovel ?? null,
      zona:
        applyFirstCriteria.zona ??
        applyFirstCriteria.municipio ??
        applyFirstCriteria.freguesia ??
        null,
    });
    const { error: uErr } = await supabase
      .from("active_searches")
      .update({
        criteria: applyFirstCriteria,
        dedup_key: firstDedup,
        flagged_for_review: false,
        decision_reason: "Dividido manualmente pelo administrador",
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        last_match_at: null,
        ...(first.location_ids ? { location_ids: first.location_ids } : {}),
      })
      .eq("id", data.id);
    if (uErr) throw new Error(uErr.message);
    createdIds.push(data.id);

    for (const p of rest) {
      const merged = { ...(source.criteria as any), ...p };
      const dedup_key = buildDedupKey({
        telefone: source.contact_telefone,
        nome: source.contact_nome,
        finalidade: (merged.finalidade ?? "indefinido") as any,
        tipologia: merged.tipologia ?? null,
        tipo_imovel: merged.tipo_imovel ?? null,
        zona: merged.zona ?? merged.municipio ?? merged.freguesia ?? null,
      });
      const { data: ins, error } = await supabase
        .from("active_searches")
        .insert({
          user_id: source.user_id,
          criteria: merged,
          location_ids: p.location_ids ?? source.location_ids ?? [],
          resumo: source.resumo,
          texto_original: source.texto_original,
          contact_nome: source.contact_nome,
          contact_telefone: source.contact_telefone,
          contact_email: source.contact_email,
          contact_grupo: source.contact_grupo,
          data_publicacao: source.data_publicacao,
          expires_at: source.expires_at,
          origem: source.origem,
          import_batch_id: source.import_batch_id,
          consultor_nome: source.consultor_nome,
          consultor_telefone: source.consultor_telefone,
          data_origem: source.data_origem,
          hora_origem: source.hora_origem,
          grupo_whatsapp: source.grupo_whatsapp,
          comunidade: source.comunidade,
          dedup_key,
          decision_reason: "Criado por divisão manual",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      createdIds.push(ins.id);
    }

    // Recruzar todas as procuras derivadas.
    for (const id of createdIds) {
      try {
        await recomputeForSearch(supabase, source.user_id, id);
      } catch (e) {
        console.error("split recompute failed", e);
      }
    }
    return { ok: true, ids: createdIds };
  });

/**
 * Deduplicação inteligente por chave. Para cada grupo com >1 registo:
 *   1) Mantém o mais COMPLETO (mais campos preenchidos).
 *   2) Empate → mantém o mais RECENTE.
 *   3) Elimina os restantes.
 * Recruza o registo mantido.
 */
export const mergeDuplicateSearches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: all, error } = await supabase
      .from("active_searches")
      .select("id, user_id, dedup_key, criteria, contact_telefone, texto_original, created_at")
      .not("dedup_key", "is", null);
    if (error) throw new Error(error.message);

    const groups = new Map<string, any[]>();
    for (const r of all ?? []) {
      const k = `${r.user_id}::${r.dedup_key}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }

    let merged = 0;
    let removed = 0;
    const keptIds: string[] = [];
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      // Escolhe o keeper: maior completeness; empate → mais recente.
      rows.sort((a, b) => {
        const ca = completenessScore(a);
        const cb = completenessScore(b);
        if (ca !== cb) return cb - ca;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      const [keeper, ...losers] = rows;
      const loserIds = losers.map((x) => x.id);
      const { error: dErr } = await supabase
        .from("active_searches")
        .delete()
        .in("id", loserIds);
      if (dErr) {
        console.error("dedup delete failed", dErr);
        continue;
      }
      removed += loserIds.length;
      merged++;
      keptIds.push(keeper.id);
    }

    // Recruzar cada keeper para regenerar oportunidades.
    for (const id of keptIds) {
      try {
        const { data: k } = await supabase
          .from("active_searches")
          .select("user_id")
          .eq("id", id)
          .maybeSingle();
        if (k) await recomputeForSearch(supabase, k.user_id, id);
      } catch (e) {
        console.error("dedup recompute failed", e);
      }
    }
    return { grupos_com_duplicados: merged, registos_removidos: removed };
  });

/**
 * "Recruzar tudo" — passo administrativo único que:
 *   1) Corre mergeDuplicateSearches.
 *   2) Purga match_opportunities cujas procuras ou imóveis já não passam
 *      nos hard filters actuais.
 */
export const recruzarTudo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    // 1) Merge duplicados (partilhar a mesma lógica sem chamar o wrapper).
    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    // Políticas de administrador cobrem estas tabelas: sem service_role key.
    const supabaseAdmin = context.supabase as any;
    const { data: all } = await supabaseAdmin
      .from("active_searches")
      .select("id, user_id, dedup_key, criteria, contact_telefone, texto_original, created_at")
      .not("dedup_key", "is", null);
    const groups = new Map<string, any[]>();
    for (const r of all ?? []) {
      const k = `${r.user_id}::${r.dedup_key}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    let dupsRemoved = 0;
    const keptIds: string[] = [];
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      rows.sort((a, b) => {
        const ca = completenessScore(a);
        const cb = completenessScore(b);
        if (ca !== cb) return cb - ca;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      const [keeper, ...losers] = rows;
      await supabaseAdmin.from("active_searches").delete().in("id", losers.map((x) => x.id));
      dupsRemoved += losers.length;
      keptIds.push(keeper.id);
    }

    // 2) Purge stale opportunities — re-executa hard filters em memória.
    const { data: opps } = await supabaseAdmin
      .from("match_opportunities")
      .select(
        "id, user_id, active_search_id, property_id, active_searches(criteria, location_ids), properties(*)",
      );
    const staleIds: string[] = [];
    for (const o of opps ?? []) {
      const s = (o as any).active_searches;
      const p = (o as any).properties;
      if (!s || !p) {
        staleIds.push(o.id);
        continue;
      }
      const r = scoreMatch(criteriaToBuyer(s.criteria, (s as any).location_ids ?? []), p);
      if (!r.compatible || r.score < 60) staleIds.push(o.id);
    }
    if (staleIds.length > 0) {
      await supabaseAdmin.from("match_opportunities").delete().in("id", staleIds);
    }
    return {
      duplicados_removidos: dupsRemoved,
      oportunidades_purgadas: staleIds.length,
      registos_dedup_mantidos: keptIds.length,
    };
  });

// ---------------------------------------------------------------------------
// Release 1.2 — Zonas por Aprovar (Motor Geo Funcional)
// ---------------------------------------------------------------------------

/**
 * Lista expressões de zona desconhecidas, agrupadas por texto normalizado
 * e ordenadas pela ocorrência mais frequente. Cada grupo contém os ids das
 * procuras afetadas, permitindo recruzamento cirúrgico após aprovação.
 */
export const listUnknownZones = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("active_searches")
      .select("id, user_id, criteria, texto_original, resumo, created_at, decision_reason")
      .ilike("decision_reason", "%zona_desconhecida%")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const groups = new Map<
      string,
      { expression: string; count: number; search_ids: string[]; samples: string[] }
    >();
    for (const r of data ?? []) {
      const c = (r.criteria ?? {}) as any;
      const expr = c?.zona ?? c?.municipio ?? c?.freguesia ?? null;
      if (!expr) continue;
      const key = normalizeGeoText(expr);
      if (!key) continue;
      const g =
        groups.get(key) ??
        { expression: expr, count: 0, search_ids: [] as string[], samples: [] as string[] };
      g.count++;
      g.search_ids.push(r.id);
      if (g.samples.length < 3 && r.texto_original) g.samples.push(r.texto_original.slice(0, 160));
      groups.set(key, g);
    }
    const zones = Array.from(groups.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.count - a.count);
    return { zones };
  });

const CoverageSchema = z.object({
  freguesias: z.array(z.string()).default([]),
  municipios: z.array(z.string()).default([]),
});

/**
 * Cria uma nova zona funcional a partir de uma expressão sinalizada.
 * Depois de inserir, limpa `flagged_for_review` e recruza APENAS os
 * registos afetados.
 */
export const createFunctionalZoneFromReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        nome: z.string().min(2),
        aliases: z.array(z.string()).default([]),
        coverage: CoverageSchema,
        search_ids: z.array(z.string().uuid()).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    // Políticas de administrador cobrem estas tabelas: sem service_role key.
    const supabaseAdmin = context.supabase as any;
    // Normalizar aliases para minúsculas sem acentos — o resolver compara já normalizado.
    const aliases = Array.from(
      new Set(
        [data.nome, ...data.aliases]
          .map((a) => normalizeGeoText(a))
          .filter(Boolean),
      ),
    );
    const { data: zone, error: zErr } = await supabaseAdmin
      .from("functional_zones")
      .insert({
        nome: data.nome.trim(),
        aliases,
        coverage: {
          freguesias: data.coverage.freguesias.map((s) => s.trim()).filter(Boolean),
          municipios: data.coverage.municipios.map((s) => s.trim()).filter(Boolean),
        },
        approved: true,
        created_by: userId,
      })
      .select("id, nome")
      .single();
    if (zErr) throw new Error(zErr.message);

    // Limpar flags e recruzar apenas os registos afetados.
    let recomputed = 0;
    if (data.search_ids.length > 0) {
      const { error: uErr } = await supabaseAdmin
        .from("active_searches")
        .update({
          flagged_for_review: false,
          decision_reason: `Zona reconhecida como funcional: ${zone.nome}`,
        })
        .in("id", data.search_ids);
      if (uErr) console.error("clear flags failed", uErr);
      for (const sid of data.search_ids) {
        try {
          const { data: s } = await supabaseAdmin
            .from("active_searches")
            .select("user_id")
            .eq("id", sid)
            .maybeSingle();
          if (s) {
            await recomputeForSearch(supabaseAdmin, s.user_id, sid);
            recomputed++;
          }
        } catch (e) {
          console.error("zone recompute failed", e);
        }
      }
    }
    return { zone_id: zone.id, nome: zone.nome, recomputed };
  });

/**
 * Ignora uma expressão de zona sem criar zona funcional — apenas limpa o
 * flag para os ids indicados.
 */
export const ignoreUnknownZone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ search_ids: z.array(z.string().uuid()).min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    // Políticas de administrador cobrem estas tabelas: sem service_role key.
    const supabaseAdmin = context.supabase as any;
    const { error } = await supabaseAdmin
      .from("active_searches")
      .update({
        flagged_for_review: false,
        decision_reason: "Expressão de zona ignorada pelo administrador",
      })
      .in("id", data.search_ids);
    if (error) throw new Error(error.message);
    return { ok: true, cleared: data.search_ids.length };
  });

// ---------------------------------------------------------------------------
// Correções Pós-1.3 Melhoria 6 — Consultores por Completar
//
// Sempre que uma procura for atribuída a um consultor sem informação
// essencial (nome, telefone, email, agência), esse consultor tem de surgir
// na aba Revisão para o administrador completar os dados antes de disponibilizar
// oportunidades entre consultores.
// ---------------------------------------------------------------------------

function normKey(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
function normPhoneKey(v: unknown): string {
  if (v == null) return "";
  let s = String(v).replace(/\D+/g, "");
  if (s.startsWith("00")) s = s.slice(2);
  if (s.startsWith("351") && s.length > 9) s = s.slice(-9);
  return s;
}

export type IncompleteConsultor = {
  key: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  agency: string | null;
  missing: Array<"nome" | "telefone" | "email" | "agencia">;
  procuras_afetadas: number;
};

export const listIncompleteConsultores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ consultores: IncompleteConsultor[] }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    // Políticas de administrador cobrem estas tabelas: sem service_role key.
    const supabaseAdmin = context.supabase as any;
    const nowIso = new Date().toISOString();
    // Correções 1.3: audit contra o MESMO caminho de resolução do Motor
    // Match/DTO. Cada procura ativa contribui com um consultor efetivo
    // (resolveConsultor) — se o Excel não trouxer, cai no dono do upload.
    const { data: rows } = await supabaseAdmin
      .from("active_searches")
      .select("id, user_id, consultor_nome, consultor_telefone")
      .gt("expires_at", nowIso);
    // Correções 1.3: o audit NÃO usa o dono do upload como fallback — caso
    // contrário procuras sem consultor mostram nome/telefone/email/agência do
    // uploader e nada aparece como em falta. Passamos fallback = null.
    const directory = await loadConsultorDirectory();
    type G = {
      nome: string | null;
      telefone: string | null;
      email: string | null;
      agency: string | null;
      count: number;
    };
    const groups = new Map<string, G>();
    for (const r of rows ?? []) {
      const perNome = (r as any).consultor_nome ?? null;
      const perTel = (r as any).consultor_telefone ?? null;
      const resolved = resolveConsultor(directory, perNome, perTel, null);
      const key = `${normKey(resolved.nome)}|${normPhoneKey(resolved.telefone)}`;
      const g = groups.get(key) ?? {
        nome: resolved.nome,
        telefone: resolved.telefone,
        email: resolved.email,
        agency: resolved.agency,
        count: 0,
      };
      g.count++;
      // preserva o primeiro valor não-vazio
      if (!g.nome && resolved.nome) g.nome = resolved.nome;
      if (!g.telefone && resolved.telefone) g.telefone = resolved.telefone;
      if (!g.email && resolved.email) g.email = resolved.email;
      if (!g.agency && resolved.agency) g.agency = resolved.agency;
      groups.set(key, g);
    }
    const result: IncompleteConsultor[] = [];
    for (const [key, g] of groups.entries()) {
      const missing: IncompleteConsultor["missing"] = [];
      if (!g.nome || !g.nome.trim()) missing.push("nome");
      if (!g.telefone || (normalizePhone(g.telefone) ?? "").length < 9) missing.push("telefone");
      if (!g.email) missing.push("email");
      if (!g.agency) missing.push("agencia");
      if (missing.length === 0) continue;
      result.push({
        key,
        nome: g.nome,
        telefone: g.telefone,
        email: g.email,
        agency: g.agency,
        missing,
        procuras_afetadas: g.count,
      });
    }
    result.sort((a, b) => b.procuras_afetadas - a.procuras_afetadas);
    return { consultores: result };
  });

// ---------------------------------------------------------------------------
// Sprint 1.2.3 — Revisão focada em contactos sem telefone válido
//
// A página Revisão passa a apresentar apenas consultores/contactos cujo
// telefone é NULL, vazio, só espaços ou inválido após normalização (PT).
// Cada grupo agrega as active_searches afetadas para permitir gravação
// do novo telefone em cascata e remoção imediata da lista após correção.
// ---------------------------------------------------------------------------

export type ConsultorSemTelefone = {
  key: string;
  nome: string | null;
  email: string | null;
  agency: string | null;
  telefone_bruto: string | null;
  search_ids: string[];
  procuras_afetadas: number;
  amostras: Array<{ id: string; texto: string | null; origem: string | null; created_at: string }>;
};

export const listConsultoresSemTelefone = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ consultores: ConsultorSemTelefone[] }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    // Políticas de administrador cobrem estas tabelas: sem service_role key.
    const supabaseAdmin = context.supabase as any;
    const nowIso = new Date().toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from("active_searches")
      .select(
        "id, consultor_nome, consultor_telefone, consultor_email, contact_nome, contact_telefone, texto_original, origem, created_at",
      )
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const directory = await loadConsultorDirectory();
    type G = ConsultorSemTelefone;
    const groups = new Map<string, G>();
    for (const r of rows ?? []) {
      const perNome = (r as any).consultor_nome ?? (r as any).contact_nome ?? null;
      const perTel = (r as any).consultor_telefone ?? (r as any).contact_telefone ?? null;
      // Só entra na Revisão se o telefone efetivo for inválido.
      if ((normalizePhone(perTel) ?? "").length >= 9) continue;
      const resolved = resolveConsultor(directory, perNome, perTel, null);
      // Se o directory conseguiu resolver um telefone válido, considera OK.
      if ((normalizePhone(resolved.telefone) ?? "").length >= 9) continue;
      const key = normKey(resolved.nome ?? perNome) || `sem-nome:${r.id}`;
      const g: G =
        groups.get(key) ??
        ({
          key,
          nome: resolved.nome ?? perNome ?? null,
          email: resolved.email ?? null,
          agency: resolved.agency ?? null,
          telefone_bruto: perTel ?? null,
          search_ids: [] as string[],
          procuras_afetadas: 0,
          amostras: [] as G["amostras"],
        } as G);
      g.search_ids.push(r.id);
      g.procuras_afetadas++;
      if (!g.nome && (resolved.nome || perNome)) g.nome = resolved.nome ?? perNome ?? null;
      if (!g.email && resolved.email) g.email = resolved.email;
      if (!g.agency && resolved.agency) g.agency = resolved.agency;
      if (!g.telefone_bruto && perTel) g.telefone_bruto = perTel;
      if (g.amostras.length < 3) {
        g.amostras.push({
          id: r.id,
          texto: (r as any).texto_original ?? null,
          origem: (r as any).origem ?? null,
          created_at: (r as any).created_at,
        });
      }
      groups.set(key, g);
    }
    const consultores = Array.from(groups.values()).sort(
      (a, b) => b.procuras_afetadas - a.procuras_afetadas,
    );
    return { consultores };
  });

export const setConsultorTelefone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        search_ids: z.array(z.string().uuid()).min(1),
        telefone: z.string().trim().min(6),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const norm = normalizePhone(data.telefone);
    if (!norm || norm.length < 9) {
      throw new Error("Número de telefone inválido. Introduza pelo menos 9 dígitos.");
    }
    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    // Políticas de administrador cobrem estas tabelas: sem service_role key.
    const supabaseAdmin = context.supabase as any;
    const { error } = await supabaseAdmin
      .from("active_searches")
      .update({
        consultor_telefone: data.telefone.trim(),
        flagged_for_review: false,
      })
      .in("id", data.search_ids);
    if (error) throw new Error(error.message);
    return { ok: true, updated: data.search_ids.length };
  });
export type BulkPhoneLineResult = {
  linha: number;
  status: "atualizada" | "erro";
  procuras_atualizadas: number;
  motivo?: string;
};

export const bulkSetConsultorTelefone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        linhas: z
          .array(
            z.object({
              linha: z.number().int(),
              search_ids: z.array(z.string().uuid()).min(1),
              telefone: z.string().trim().min(6),
            }),
          )
          .min(1)
          .max(500),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ atualizadas: number; erros: number; resultados: BulkPhoneLineResult[] }> => {
      const { supabase, userId } = context;
      await assertAdmin(supabase, userId);
      const { setRequestClient } = await import("@/lib/privileged.server");
      setRequestClient(context.supabase);
      // Políticas de administrador cobrem estas tabelas: sem service_role key.
      const supabaseAdmin = context.supabase as any;
      const nowIso = new Date().toISOString();

      const allIds = Array.from(new Set(data.linhas.flatMap((l) => l.search_ids)));
      const { data: existing, error: exErr } = await supabaseAdmin
        .from("active_searches")
        .select("id, contact_nome, consultor_nome, contact_email")
        .in("id", allIds)
        .gt("expires_at", nowIso);
      if (exErr) throw new Error(exErr.message);
      const valid = new Set<string>((existing ?? []).map((r: any) => r.id as string));
      const byId = new Map<string, any>((existing ?? []).map((r: any) => [r.id as string, r]));

      const resultados: BulkPhoneLineResult[] = [];
      for (const l of data.linhas) {
        const norm = normalizePhone(l.telefone);
        if (!norm || norm.length < 9) {
          resultados.push({
            linha: l.linha,
            status: "erro",
            procuras_atualizadas: 0,
            motivo: "Número de telefone inválido (mínimo 9 dígitos).",
          });
          continue;
        }
        const ids = l.search_ids.filter((id) => valid.has(id));
        if (ids.length === 0) {
          resultados.push({
            linha: l.linha,
            status: "erro",
            procuras_atualizadas: 0,
            motivo: "Nenhuma procura ativa encontrada para os search_ids indicados.",
          });
          continue;
        }
        const { error } = await supabaseAdmin
          .from("active_searches")
          .update({ consultor_telefone: l.telefone.trim(), flagged_for_review: false })
          .in("id", ids);
        if (error) {
          resultados.push({
            linha: l.linha,
            status: "erro",
            procuras_atualizadas: 0,
            motivo: error.message,
          });
          continue;
        }
        const desconhecidos = l.search_ids.length - ids.length;
        // Aprendizagem de contacto: guardar o par (nome, telefone) para que
        // importações futuras da mesma pessoa já venham preenchidas, mesmo que
        // o ficheiro de origem não traga o número.
        {
          const { saveContact } = await import("./contacts.server");
          const nomes = new Set<string>();
          for (const id of ids) {
            const r = byId.get(id);
            const nm = (r?.contact_nome ?? r?.consultor_nome ?? "").trim();
            if (nm) nomes.add(nm);
          }
          for (const nm of nomes) {
            await saveContact(supabaseAdmin, {
              nome: nm,
              telefone: norm,
              origem: "revisao",
            });
          }
        }
        resultados.push({
          linha: l.linha,
          status: "atualizada",
          procuras_atualizadas: ids.length,
          motivo:
            desconhecidos > 0
              ? `${desconhecidos} search_id(s) ignorado(s): inexistente(s) ou expirado(s).`
              : undefined,
        });
      }

      return {
        atualizadas: resultados.filter((r) => r.status === "atualizada").length,
        erros: resultados.filter((r) => r.status === "erro").length,
        resultados,
      };
    },
  );

// ---------------------------------------------------------------------------
// Revisão — Procuras sem localização resolvida
//
// Lista as procuras ativas cujo `location_ids` está vazio (o backfill não
// conseguiu resolver texto geográfico aproveitável). Serve para revisão
// manual, uma a uma, com a mensagem original visível. A correção é feita
// exclusivamente pelo LocationSelector (IDs) — nunca por texto livre.
// ---------------------------------------------------------------------------

export type SearchSemLocalizacao = {
  id: string;
  user_id: string;
  origem: string | null;
  created_at: string;
  resumo: string | null;
  texto_original: string | null;
  consultor_nome: string | null;
  consultor_telefone: string | null;
  contact_nome: string | null;
  grupo_whatsapp: string | null;
  criteria_geo: {
    zona: string | null;
    freguesia: string | null;
    municipio: string | null;
    distrito: string | null;
  };
};

export type SearchSemLocalizacaoItem = SearchSemLocalizacao & {
  /** Item 4 — país detetado quando a localização é claramente fora de Portugal. */
  foreign: { country: string; marker: string } | null;
  /** Item 4a — parece um anúncio de imóvel (oferta) e não uma procura. */
  offer: { marker: string } | null;
};

export const listSearchesSemLocalizacao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ items: SearchSemLocalizacaoItem[]; total: number; foreign_count: number }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    const nowIso = new Date().toISOString();
    const { data, error } = await (context.supabase as any)
      .from("active_searches")
      .select(
        "id, user_id, origem, created_at, resumo, texto_original, criteria, location_ids, consultor_nome, consultor_telefone, contact_nome, grupo_whatsapp",
      )
      .eq("descartado", false)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []).filter(
      (r: any) => !Array.isArray(r.location_ids) || r.location_ids.length === 0,
    );
    const { detectForeignLocation } = await import("@/lib/geo/foreign-detect");
    const { detectOfferPosing } = await import("@/lib/offer-detect");
    const items: SearchSemLocalizacaoItem[] = rows.map((r: any) => {
      const c = (r.criteria ?? {}) as any;
      return {
        id: r.id,
        user_id: r.user_id,
        origem: r.origem ?? null,
        created_at: r.created_at,
        resumo: r.resumo ?? null,
        texto_original: r.texto_original ?? null,
        consultor_nome: r.consultor_nome ?? null,
        consultor_telefone: r.consultor_telefone ?? null,
        contact_nome: r.contact_nome ?? null,
        grupo_whatsapp: r.grupo_whatsapp ?? null,
        criteria_geo: {
          zona: c.zona ?? null,
          freguesia: c.freguesia ?? null,
          municipio: c.municipio ?? null,
          distrito: c.distrito ?? null,
        },
        foreign: detectForeignLocation(
          c.zona,
          c.freguesia,
          c.municipio,
          c.distrito,
          r.resumo,
          r.texto_original,
        ),
        offer: detectOfferPosing(r.resumo, r.texto_original),
      };
    });
    return {
      items,
      total: items.length,
      foreign_count: items.filter((i) => i.foreign !== null).length,
    };
  });

/**
 * Item 4 — descarta procuras (soft-delete). Usado para:
 *  (a) entradas que não são procuras reais (ex. anúncios de venda importados
 *      por engano como procura);
 *  (b)/(c) procuras cuja localização está fora de Portugal, logo fora do
 *      âmbito do motor geográfico.
 * Nada é apagado: o registo e a mensagem original ficam guardados, apenas
 * saem das listas e do motor de match.
 */
export const discardSearches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(2000),
        motivo: z.string().trim().min(3).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: n, error } = await (context.supabase as any).rpc("admin_discard_searches", {
      p_ids: data.ids,
      p_motivo: data.motivo,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, discarded: Number(n ?? 0) };
  });

export const restoreSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await (context.supabase as any).rpc("admin_restore_search", { p_id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/**
 * Grava manualmente as localizações de uma procura (IDs da biblioteca) e
 * recruza imediatamente essa procura no Motor Match.
 */
export const setSearchLocations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        location_ids: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    const { LocationRepository } = await import("@/lib/geo");
    const snap = await LocationRepository.getSnapshot();
    const validIds = data.location_ids.filter((id) => snap.byId.has(id));
    if (validIds.length === 0) throw new Error("Nenhuma localização válida.");

    const supabaseAdmin = context.supabase as any;
    const { data: existing, error: gErr } = await supabaseAdmin
      .from("active_searches")
      .select("id, user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (gErr) throw new Error(gErr.message);
    if (!existing) throw new Error("Procura não encontrada.");

    const { error } = await supabaseAdmin
      .from("active_searches")
      .update({
        location_ids: validIds,
        geo_library_version: snap.version,
        pending_geo: false,
        decision_reason: "Localização revista manualmente pelo administrador",
        last_match_at: null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    try {
      await recomputeForSearch(supabaseAdmin, existing.user_id, data.id);
    } catch (e) {
      console.error("setSearchLocations recompute failed", e);
    }
    return { ok: true as const, location_ids: validIds };
  });

/**
 * Item 7 — aplica a mesma interpretação geográfica a todas as procuras que
 * partilham o mesmo texto original não resolvido. Uma decisão humana passa a
 * resolver o grupo inteiro, em vez de repetir a mesma escolha N vezes.
 */
export const setSearchLocationsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(500),
        location_ids: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    const { LocationRepository } = await import("@/lib/geo");
    const snap = await LocationRepository.getSnapshot();
    const validIds = data.location_ids.filter((id) => snap.byId.has(id));
    if (validIds.length === 0) throw new Error("Nenhuma localização válida.");

    const supabaseAdmin = context.supabase as any;
    const { data: rows, error: gErr } = await supabaseAdmin
      .from("active_searches")
      .select("id, user_id")
      .in("id", data.ids);
    if (gErr) throw new Error(gErr.message);
    const targets = (rows ?? []) as Array<{ id: string; user_id: string }>;
    if (targets.length === 0) throw new Error("Nenhuma procura encontrada.");

    const { error } = await supabaseAdmin
      .from("active_searches")
      .update({
        location_ids: validIds,
        geo_library_version: snap.version,
        pending_geo: false,
        decision_reason: "Localização revista manualmente pelo administrador (grupo de texto igual)",
        last_match_at: null,
      })
      .in(
        "id",
        targets.map((t) => t.id),
      );
    if (error) throw new Error(error.message);

    for (const t of targets) {
      try {
        await recomputeForSearch(supabaseAdmin, t.user_id, t.id);
      } catch (e) {
        console.error("setSearchLocationsBulk recompute failed", t.id, e);
      }
    }
    return { ok: true as const, updated: targets.length, location_ids: validIds };
  });
