import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recomputeForSearch } from "./active-searches.functions";
import { buildDedupKey } from "./dedup";
import { scoreMatch, type BuyerLike } from "./matching-engine";
import { loadZoneContext, resolveZone } from "./functional-zones";
import { normalizeLocation } from "./location-graph";
import { loadConsultorDirectory } from "./opportunity-privacy";

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
        "id, user_id, criteria, resumo, texto_original, contact_nome, contact_telefone, contact_email, contact_grupo, consultor_nome, consultor_telefone, comunidade, grupo_whatsapp, origem, decision_reason, similarity_score, created_at, data_origem",
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
        resolve: z.boolean().default(true),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: existing, error: gErr } = await supabase
      .from("active_searches")
      .select("id, user_id, criteria, contact_telefone, contact_nome")
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

const SplitInput = z.object({
  id: z.string().uuid(),
  parts: z.array(CriteriaPatch).min(1).max(10),
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
        "id, user_id, active_search_id, property_id, active_searches(criteria), properties(*)",
      );
    const staleIds: string[] = [];
    for (const o of opps ?? []) {
      const s = (o as any).active_searches;
      const p = (o as any).properties;
      if (!s || !p) {
        staleIds.push(o.id);
        continue;
      }
      const r = scoreMatch(criteriaToBuyer(s.criteria), p);
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
      const key = normalizeLocation(expr);
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Normalizar aliases para minúsculas sem acentos — o resolver compara já normalizado.
    const aliases = Array.from(
      new Set(
        [data.nome, ...data.aliases]
          .map((a) => normalizeLocation(a))
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nowIso = new Date().toISOString();
    const [{ data: rows }, directory] = await Promise.all([
      supabaseAdmin
        .from("active_searches")
        .select("id, consultor_nome, consultor_telefone")
        .gt("expires_at", nowIso),
      loadConsultorDirectory(),
    ]);
    const groups = new Map<
      string,
      { nome: string | null; telefone: string | null; count: number }
    >();
    for (const r of rows ?? []) {
      const nome = (r as any).consultor_nome ?? null;
      const telefone = (r as any).consultor_telefone ?? null;
      if (!nome && !telefone) continue;
      const key = `${normKey(nome)}|${normPhoneKey(telefone)}`;
      const g = groups.get(key) ?? { nome, telefone, count: 0 };
      g.count++;
      // preserva o primeiro nome/telefone não-vazio
      if (!g.nome && nome) g.nome = nome;
      if (!g.telefone && telefone) g.telefone = telefone;
      groups.set(key, g);
    }
    const result: IncompleteConsultor[] = [];
    for (const [key, g] of groups.entries()) {
      const hitPhone = g.telefone
        ? directory.byPhone.get(normPhoneKey(g.telefone))
        : undefined;
      const hitName = g.nome
        ? directory.byName.get(normKey(g.nome))
        : undefined;
      const hit = hitPhone ?? hitName ?? null;
      const nome = g.nome ?? hit?.nome ?? null;
      const telefone = g.telefone ?? hit?.telefone ?? null;
      const email = hit?.email ?? null;
      const agency = hit?.agency ?? null;
      const missing: IncompleteConsultor["missing"] = [];
      if (!nome || !nome.trim()) missing.push("nome");
      if (!telefone || normPhoneKey(telefone).length < 9) missing.push("telefone");
      if (!email) missing.push("email");
      if (!agency) missing.push("agencia");
      if (missing.length === 0) continue;
      result.push({
        key,
        nome,
        telefone,
        email,
        agency,
        missing,
        procuras_afetadas: g.count,
      });
    }
    result.sort((a, b) => b.procuras_afetadas - a.procuras_afetadas);
    return { consultores: result };
  });