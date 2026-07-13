import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scoreMatch, type BuyerLike } from "./matching-engine";
import { buildDedupKey, normalizePhone, scoreSimilarity, type SimilarityCriteria } from "./dedup";
import { loadZoneContext } from "./functional-zones";
import { extractProximityCriteria } from "./search-splitter.server";

const CriteriaSchema = z.object({
  nome: z.string().nullable().optional(),
  finalidade: z.enum(["venda", "arrendamento", "indefinido"]).default("indefinido"),
  tipo_imovel: z.array(z.string()).nullable().optional(),
  tipologia: z.string().nullable().optional(),
  zona: z.string().nullable().optional(),
  budget_min: z.number().nullable().optional(),
  budget_max: z.number().nullable().optional(),
  area_min: z.number().nullable().optional(),
  quartos_min: z.number().nullable().optional(),
  caracteristicas: z.array(z.string()).nullable().optional(),
  freguesia: z.string().nullable().optional(),
  municipio: z.string().nullable().optional(),
  distrito: z.string().nullable().optional(),
  area_terreno_min: z.number().nullable().optional(),
  wc_min: z.number().nullable().optional(),
  proximity: z
    .array(z.object({ poi: z.string(), minutes: z.number().int().positive() }))
    .nullable()
    .optional(),
});

export type ActiveSearchCriteria = z.infer<typeof CriteriaSchema>;

const SaveInput = z.object({
  criteria: CriteriaSchema,
  resumo: z.string().nullable().optional(),
  texto_original: z.string().nullable().optional(),
  contact_nome: z.string().nullable().optional(),
  contact_telefone: z.string().nullable().optional(),
  contact_email: z.string().nullable().optional(),
  contact_grupo: z.string().nullable().optional(),
  data_publicacao: z.string().nullable().optional(),
  duration_days: z.number().int().min(1).max(60).default(14),
  origem: z.enum(["excel", "whatsapp", "texto", "captura"]).default("whatsapp"),
  // Release 1.2 — metadados de contexto da oportunidade
  consultor_nome: z.string().nullable().optional(),
  consultor_telefone: z.string().nullable().optional(),
  data_origem: z.string().nullable().optional(),
  hora_origem: z.string().nullable().optional(),
  grupo_whatsapp: z.string().nullable().optional(),
  comunidade: z.string().nullable().optional(),
});

export const saveActiveSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SaveInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const expires = new Date(Date.now() + data.duration_days * 24 * 60 * 60 * 1000).toISOString();
    // Correções 1.3: normalizar telefones ANTES da persistência para que
    // exista um único formato interno (9 dígitos PT / E.164-lite).
    const contactPhoneNorm = normalizePhone(data.contact_telefone) ?? null;
    const consultorPhoneNorm = normalizePhone(data.consultor_telefone) ?? null;
    const dedup_key = buildDedupKey({
      telefone: contactPhoneNorm,
      nome: data.contact_nome ?? data.criteria.nome ?? null,
      finalidade: data.criteria.finalidade,
      tipologia: data.criteria.tipologia ?? null,
      tipo_imovel: data.criteria.tipo_imovel ?? null,
      zona: data.criteria.zona ?? null,
    });
    const res = await upsertOne(supabase, userId, {
      dedup_key,
      criteria: data.criteria,
      resumo: data.resumo ?? null,
      texto_original: data.texto_original ?? null,
      contact_nome: data.contact_nome ?? null,
      contact_telefone: contactPhoneNorm,
      contact_email: data.contact_email ?? null,
      contact_grupo: data.contact_grupo ?? null,
      data_publicacao: data.data_publicacao ?? null,
      expires_at: expires,
      origem: data.origem,
      import_batch_id: null,
      consultor_nome: data.consultor_nome ?? null,
      consultor_telefone: consultorPhoneNorm,
      data_origem: data.data_origem ?? null,
      hora_origem: data.hora_origem ?? null,
      grupo_whatsapp: data.grupo_whatsapp ?? data.contact_grupo ?? null,
      comunidade: data.comunidade ?? null,
    });
    // Release 1.1: sempre que entra uma procura ativa, cruzar imediatamente
    // com todos os imóveis ativos e materializar oportunidades novas.
    try {
      await recomputeForSearch(supabase, userId, res.id);
    } catch (e) {
      console.error("recomputeForSearch failed", e);
    }
    // Release 1.2 — se a zona indicada não é reconhecida como administrativa
    // nem como zona funcional, marcar para Revisão (motivo zona_desconhecida).
    try {
      const zonaText = data.criteria.zona ?? data.criteria.municipio ?? data.criteria.freguesia ?? null;
      if (zonaText) {
        const zoneCtx = await loadZoneContext();
        const resolved = (await import("./functional-zones")).resolveZone(zonaText, zoneCtx);
        if (resolved.unknown) {
          await supabase
            .from("active_searches")
            .update({
              flagged_for_review: true,
              decision_reason: `zona_desconhecida: "${zonaText}"`,
            })
            .eq("id", res.id)
            .eq("user_id", userId);
        }
      }
    } catch (e) {
      console.error("zone review flagging failed", e);
    }
    return {
      id: res.id,
      expires_at: res.expires_at,
      action: res.action,
      similarity: res.similarity,
      flagged_for_review: res.flagged_for_review,
    };
  });

// Helper interno partilhado entre saveActiveSearch e a server fn pública.
async function recomputeForSearch(supabase: any, userId: string, searchId: string): Promise<number> {
  // Release 1.2 — Base Global: materializa oportunidades para TODOS os
  // imóveis (independentemente do dono) usando o cliente de admin.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: s } = await supabaseAdmin
    .from("active_searches")
    .select("id, criteria")
    .eq("id", searchId)
    .maybeSingle();
  if (!s) return 0;
  const { data: props } = await supabaseAdmin
    .from("properties")
    .select(
      "id, user_id, tipo_imovel, tipologia, distrito, concelho, freguesia, zona, preco, area_util_m2, area_m2, quartos, garagem, elevador, jardim, piscina, finalidade",
    )
    .eq("ativo", true);
  const buyer = criteriaToBuyer(s.criteria as ActiveSearchCriteria);
  const zoneContext = await loadZoneContext();
  const { data: existing } = await supabaseAdmin
    .from("match_opportunities")
    .select("id, property_id, score, user_id")
    .eq("active_search_id", s.id);
  const existingMap = new Map<string, { id: string; score: number; user_id: string }>(
    (existing ?? []).map((e: any) => [e.property_id, { id: e.id, score: e.score, user_id: e.user_id }]),
  );
  let created = 0;
  for (const p of props ?? []) {
    const r = scoreMatch(buyer, p, { zoneContext });
    if (!r.compatible || r.score < 60) continue;
    const prev = existingMap.get(p.id);
    if (!prev) {
      await supabaseAdmin.from("match_opportunities").insert({
        user_id: (p as any).user_id,
        property_id: p.id,
        active_search_id: s.id,
        score: r.score,
        reasons: r.reasons,
        categories: r.categories as any,
      });
      created++;
    } else if (prev.score !== r.score) {
      await supabaseAdmin
        .from("match_opportunities")
        .update({ score: r.score, reasons: r.reasons, categories: r.categories as any, viewed_at: null })
        .eq("id", prev.id);
    }
  }
  return created;
}

export { recomputeForSearch };

// Release 1.2 — quando um imóvel é criado/atualizado, materializa
// oportunidades cruzando com a Base Global de procuras (via admin).
export async function recomputeForProperty(propertyId: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: p } = await supabaseAdmin
    .from("properties")
    .select("id, user_id, tipo_imovel, tipologia, distrito, concelho, freguesia, zona, preco, area_util_m2, area_m2, quartos, garagem, elevador, jardim, piscina, finalidade, ativo")
    .eq("id", propertyId)
    .maybeSingle();
  if (!p || !p.ativo) return 0;
  const nowIso = new Date().toISOString();
  const zoneContext = await loadZoneContext();
  const { data: searches } = await supabaseAdmin
    .from("active_searches")
    .select("id, criteria")
    .gt("expires_at", nowIso);
  const { data: existing } = await supabaseAdmin
    .from("match_opportunities")
    .select("id, active_search_id, score")
    .eq("property_id", p.id);
  const existingMap = new Map<string, { id: string; score: number }>(
    (existing ?? []).map((e: any) => [e.active_search_id, { id: e.id, score: e.score }]),
  );
  let created = 0;
  for (const s of searches ?? []) {
    const buyer = criteriaToBuyer(s.criteria as ActiveSearchCriteria);
    const r = scoreMatch(buyer, p as any, { zoneContext });
    if (!r.compatible || r.score < 60) continue;
    const prev = existingMap.get(s.id);
    if (!prev) {
      await supabaseAdmin.from("match_opportunities").insert({
        user_id: (p as any).user_id,
        property_id: p.id,
        active_search_id: s.id,
        score: r.score,
        reasons: r.reasons,
        categories: r.categories as any,
      });
      created++;
    } else if (prev.score !== r.score) {
      await supabaseAdmin
        .from("match_opportunities")
        .update({ score: r.score, reasons: r.reasons, categories: r.categories as any, viewed_at: null })
        .eq("id", prev.id);
    }
  }
  return created;
}

// Server fn callable from the client after saving a property.
export const recomputeOpportunitiesForProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ propertyId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Confirmar posse (RLS) antes de tocar via admin.
    const { data: p } = await supabase
      .from("properties")
      .select("id")
      .eq("id", data.propertyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!p) return { created: 0 };
    const created = await recomputeForProperty(data.propertyId);
    return { created };
  });

// ---------------------------------------------------------------------------
// Deduplicação inteligente — usada por Excel + WhatsApp + texto + captura.
//
// Algoritmo:
// 1) Procurar candidatos (mesmo telefone normalizado, dentro do user).
// 2) Calcular score determinístico (0-100) contra cada candidato.
// 3) Decidir:
//    - score >= 95 → duplicado exato → UPDATE
//    - 80-94       → chamar IA → update | new | review
//    - < 80        → nova procura
// 4) Em qualquer inserção guarda o motivo em `decision_reason` para auditoria.
// ---------------------------------------------------------------------------

export type UpsertRow = {
  dedup_key: string;
  criteria: Record<string, unknown>;
  resumo: string | null;
  texto_original: string | null;
  contact_nome: string | null;
  contact_telefone: string | null;
  contact_email: string | null;
  contact_grupo: string | null;
  data_publicacao: string | null;
  expires_at: string;
  origem: "excel" | "whatsapp" | "texto" | "captura";
  import_batch_id: string | null;
  consultor_nome?: string | null;
  consultor_telefone?: string | null;
  data_origem?: string | null;
  hora_origem?: string | null;
  grupo_whatsapp?: string | null;
  comunidade?: string | null;
};

export type UpsertAction = "created" | "updated" | "kept_separate" | "flagged";

export type UpsertResult = {
  id: string;
  expires_at: string;
  action: UpsertAction;
  similarity: number;
  flagged_for_review: boolean;
  reason: string;
};

function mergeCriteria(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  if (!existing) return incoming;
  const merged: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    merged[k] = v;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Curto-circuito determinístico para duplicados verdadeiramente idênticos.
// Devolve true apenas quando existe correspondência estrita em: telefone
// normalizado, consultor (nome+telefone), nome do comprador, texto original
// e assinatura canónica dos critérios essenciais.
// ---------------------------------------------------------------------------
function normText(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "";
}
function normArr(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return [...v]
    .map((x) => normText(x))
    .filter(Boolean)
    .sort()
    .join(",");
}
function criteriaSignature(c: Record<string, unknown> | null | undefined): string {
  const x = (c ?? {}) as Record<string, unknown>;
  return JSON.stringify({
    finalidade: normText(x.finalidade) || "indefinido",
    tipologia: normText(x.tipologia),
    tipo_imovel: normArr(x.tipo_imovel),
    zona: normText(x.zona) || normText(x.municipio) || normText(x.freguesia),
    budget_min: x.budget_min ?? null,
    budget_max: x.budget_max ?? null,
    area_min: x.area_min ?? null,
    quartos_min: x.quartos_min ?? null,
    caracteristicas: normArr(x.caracteristicas),
  });
}
function isExactDuplicate(candidate: any, incoming: UpsertRow): boolean {
  // Consultor — se ambos os lados o têm, tem de ser o mesmo. Se um lado
  // não o tem, não bloqueia (evita perder o auto-merge por falta de dados).
  const cCons = normText(candidate?.consultor_nome);
  const iCons = normText(incoming.consultor_nome);
  if (cCons && iCons && cCons !== iCons) return false;
  const cConsTel = normalizePhone(candidate?.consultor_telefone);
  const iConsTel = normalizePhone(incoming.consultor_telefone);
  if (cConsTel && iConsTel && cConsTel !== iConsTel) return false;
  // Nome do comprador — se ambos preenchidos, iguais.
  const cNome = normText(candidate?.contact_nome);
  const iNome = normText(incoming.contact_nome);
  if (cNome && iNome && cNome !== iNome) return false;
  // Texto original — se ambos preenchidos, iguais.
  const cText = normText(candidate?.texto_original ?? candidate?.resumo);
  const iText = normText(incoming.texto_original ?? incoming.resumo);
  if (cText && iText && cText !== iText) return false;
  // Critérios essenciais têm de bater certo.
  if (criteriaSignature(candidate?.criteria) !== criteriaSignature(incoming.criteria)) return false;
  return true;
}

async function mergeInto(
  supabase: any,
  userId: string,
  existingId: string,
  existing: any,
  row: UpsertRow,
  similarity: number,
  reason: string,
): Promise<UpsertResult> {
  const nextCriteria = mergeCriteria(existing.criteria as Record<string, unknown>, row.criteria);
  const update: Record<string, unknown> = {
    criteria: nextCriteria,
    expires_at: row.expires_at,
    origem: row.origem,
    import_batch_id: row.import_batch_id,
    resumo: row.resumo ?? existing.resumo,
    texto_original: row.texto_original ?? existing.texto_original,
    contact_nome: row.contact_nome ?? existing.contact_nome,
    contact_email: row.contact_email ?? existing.contact_email,
    contact_grupo: row.contact_grupo ?? existing.contact_grupo,
    data_publicacao: row.data_publicacao ?? existing.data_publicacao,
    similarity_score: similarity,
    decision_reason: reason.slice(0, 900),
    merged_from_count: (existing.merged_from_count ?? 0) + 1,
    consultor_nome: row.consultor_nome ?? existing.consultor_nome,
    consultor_telefone: row.consultor_telefone ?? existing.consultor_telefone,
    data_origem: row.data_origem ?? existing.data_origem,
    hora_origem: row.hora_origem ?? existing.hora_origem,
    grupo_whatsapp: row.grupo_whatsapp ?? existing.grupo_whatsapp,
    comunidade: row.comunidade ?? existing.comunidade,
  };
  const { data: upd, error } = await supabase
    .from("active_searches")
    .update(update)
    .eq("id", existingId)
    .eq("user_id", userId)
    .select("id, expires_at, flagged_for_review")
    .single();
  if (error) throw new Error(error.message);
  return {
    id: upd.id,
    expires_at: upd.expires_at,
    action: "updated",
    similarity,
    flagged_for_review: !!upd.flagged_for_review,
    reason,
  };
}

async function insertNew(
  supabase: any,
  userId: string,
  row: UpsertRow,
  similarity: number,
  reason: string,
  action: Exclude<UpsertAction, "updated">,
): Promise<UpsertResult> {
  const { data: ins, error } = await supabase
    .from("active_searches")
    .insert({
      user_id: userId,
      dedup_key: row.dedup_key,
      criteria: row.criteria,
      resumo: row.resumo,
      texto_original: row.texto_original,
      contact_nome: row.contact_nome,
      contact_telefone: row.contact_telefone,
      contact_email: row.contact_email,
      contact_grupo: row.contact_grupo,
      data_publicacao: row.data_publicacao,
      expires_at: row.expires_at,
      origem: row.origem,
      import_batch_id: row.import_batch_id,
      similarity_score: similarity,
      decision_reason: reason.slice(0, 900),
      flagged_for_review: action === "flagged",
      consultor_nome: row.consultor_nome ?? null,
      consultor_telefone: row.consultor_telefone ?? null,
      data_origem: row.data_origem ?? null,
      hora_origem: row.hora_origem ?? null,
      grupo_whatsapp: row.grupo_whatsapp ?? null,
      comunidade: row.comunidade ?? null,
    })
    .select("id, expires_at")
    .single();
  if (error) throw new Error(error.message);
  return {
    id: ins.id,
    expires_at: ins.expires_at,
    action,
    similarity,
    flagged_for_review: action === "flagged",
    reason,
  };
}

export async function upsertOne(
  supabase: any,
  userId: string,
  row: UpsertRow,
): Promise<UpsertResult> {
  const incomingCriteria = row.criteria as SimilarityCriteria;
  const incomingText = row.texto_original ?? row.resumo ?? null;

  // 1) Candidate lookup: só procuras do mesmo user que partilham telefone.
  //    Sem telefone não há candidatos → cria como nova (regra de segurança).
  const phone = normalizePhone(row.contact_telefone);
  if (!phone) {
    return await insertNew(supabase, userId, row, 0, "sem telefone — criada como nova", "created");
  }

  const { data: rawCandidates } = await supabase
    .from("active_searches")
    .select("id, criteria, contact_nome, contact_email, contact_grupo, contact_telefone, texto_original, resumo, data_publicacao, merged_from_count, consultor_nome, consultor_telefone, flagged_for_review")
    .eq("user_id", userId)
    .ilike("contact_telefone", `%${phone}%`)
    .limit(100);

  const candidates = (rawCandidates ?? []).filter(
    (c: any) => normalizePhone(c.contact_telefone) === phone,
  );

  if (candidates.length === 0) {
    return await insertNew(supabase, userId, row, 0, "sem candidato compatível", "created");
  }

  // Curto-circuito determinístico — duplicado exato.
  // Correções Pós-1.3 Melhoria 4: quando o registo é verdadeiramente idêntico
  // (mesmo consultor, mesmo telefone, mesmo nome, mesmo texto, mesmos
  // critérios essenciais), fundir silenciosamente. Nunca enviar para Revisão.
  const exact = candidates.find((c: any) => isExactDuplicate(c, row));
  if (exact) {
    console.info(
      `[dedup] auto-merge exact duplicate: existing=${exact.id} user=${userId} phone=${phone}`,
    );
    const res = await mergeInto(
      supabase,
      userId,
      exact.id,
      exact,
      row,
      100,
      "duplicado exato (auto-merge)",
    );
    // Limpar qualquer flag antiga de revisão neste registo.
    if ((exact as any).flagged_for_review) {
      await supabase
        .from("active_searches")
        .update({ flagged_for_review: false })
        .eq("id", exact.id);
      res.flagged_for_review = false;
    }
    return res;
  }

  // 2) Score determinístico contra cada candidato — escolhe o melhor.
  let best: any = null;
  let bestScore = 0;
  let bestReasons: string[] = [];
  for (const c of candidates) {
    const r = scoreSimilarity(
      (c.criteria ?? {}) as SimilarityCriteria,
      incomingCriteria,
      { textA: c.texto_original ?? c.resumo, textB: incomingText },
    );
    if (r.score > bestScore) {
      bestScore = r.score;
      best = c;
      bestReasons = r.reasons;
    }
  }

  const reasonSummary = bestReasons.join("; ").slice(0, 700);

  // 3) Regras de negócio + IA
  //
  // Correções Pós-1.3 Melhoria 5: o auto-merge silencioso passa a estar
  // reservado EXCLUSIVAMENTE ao curto-circuito determinístico
  // (isExactDuplicate) acima. Qualquer alteração real — mesmo com score
  // determinístico muito alto — nunca deve ser fundida silenciosamente:
  // se os dados não são identicamente iguais, o registo tem de ficar
  // visível ao administrador (Revisão) ou ser criado à parte. Antes,
  // scoreSimilarity>=95 podia fundir apesar de zona/preço mudarem —
  // exatamente o comportamento que o utilizador reportou.
  if (bestScore >= 95) {
    return await insertNew(
      supabase,
      userId,
      row,
      bestScore,
      `possível duplicado (${bestScore}%) — dados divergentes: ${reasonSummary}`,
      "flagged",
    );
  }

  if (bestScore >= 80) {
    const { aiArbitrateDedup } = await import("./dedup-ai.server");
    const ai = await aiArbitrateDedup({
      incoming: {
        criteria: row.criteria,
        texto: incomingText,
        nome: row.contact_nome,
      },
      candidate: {
        criteria: (best.criteria ?? {}) as Record<string, unknown>,
        texto: best.texto_original ?? best.resumo ?? null,
        nome: best.contact_nome,
      },
      ruleScore: bestScore,
    });
    // A decisão "update" da IA passou também a sinalizar para revisão:
    // qualquer alteração relevante fica visível ao administrador antes
    // de sobrescrever silenciosamente o registo existente.
    if (ai.decision === "update" || ai.decision === "review") {
      return await insertNew(
        supabase,
        userId,
        row,
        bestScore,
        `${ai.decision === "update" ? "IA sugere fundir" : "IA em dúvida"} (${bestScore}%): ${ai.reason} | ${reasonSummary}`,
        "flagged",
      );
    }
    return await insertNew(
      supabase,
      userId,
      row,
      bestScore,
      `IA separar (${bestScore}%): ${ai.reason} | ${reasonSummary}`,
      "kept_separate",
    );
  }

  return await insertNew(
    supabase,
    userId,
    row,
    bestScore,
    `necessidade distinta (${bestScore}%): ${reasonSummary}`,
    "created",
  );
}

async function purgeExpired(supabase: any, userId: string) {
  await supabase.from("active_searches").delete().eq("user_id", userId).lt("expires_at", new Date().toISOString());
}

export const listActiveSearches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await purgeExpired(supabase, userId);
    const { data, error } = await supabase
      .from("active_searches")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { searches: data ?? [] };
  });

export const deleteActiveSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("active_searches").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function criteriaToBuyer(c: ActiveSearchCriteria): BuyerLike {
  const finalidade = c.finalidade === "indefinido" ? undefined : c.finalidade;
  const gar = (c.caracteristicas ?? []).some((x) => /garagem/i.test(x));
  const ele = (c.caracteristicas ?? []).some((x) => /elevador/i.test(x));
  return {
    finalidade,
    tipo_imovel: c.tipo_imovel ?? null,
    tipologia: c.tipologia ?? null,
    zona: c.zona ?? null,
    freguesia: c.freguesia ?? null,
    municipio: c.municipio ?? null,
    budget_min: c.budget_min ?? null,
    budget_max: c.budget_max ?? null,
    area_min: c.area_min ?? null,
    quartos_min: c.quartos_min ?? null,
    garagem_obrigatoria: gar,
    elevador_obrigatorio: ele,
    proximity: c.proximity ?? null,
  };
}

export type ActiveSearchMatch = {
  search_id: string;
  contact_nome: string | null;
  contact_telefone: string | null;
  contact_grupo: string | null;
  data_publicacao: string | null;
  created_at: string;
  resumo: string | null;
  score: number;
  reasons: string[];
};

export const matchPropertyAgainstActiveSearches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ propertyId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await purgeExpired(supabase, userId);

    const { data: prop, error: pErr } = await supabase
      .from("properties")
      .select(
        "id, referencia, tipo_imovel, tipologia, distrito, concelho, freguesia, zona, preco, area_util_m2, area_m2, quartos, garagem, elevador, jardim, piscina, finalidade",
      )
      .eq("id", data.propertyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prop) return { property: null, matches: [] as ActiveSearchMatch[] };

    const { data: searches, error: sErr } = await supabase
      .from("active_searches")
      .select("*")
      .eq("user_id", userId);
    if (sErr) throw new Error(sErr.message);

    const matches: ActiveSearchMatch[] = [];
    const persist: Array<{ search_id: string; score: number; reasons: string[]; categories: any }> = [];
    const zoneContext = await loadZoneContext();
    for (const s of searches ?? []) {
      const buyer = criteriaToBuyer(s.criteria as ActiveSearchCriteria);
      const res = scoreMatch(buyer, prop, { zoneContext });
      if (res.compatible && res.score >= 60) {
        matches.push({
          search_id: s.id,
          contact_nome: s.contact_nome,
          contact_telefone: s.contact_telefone,
          contact_grupo: s.contact_grupo,
          data_publicacao: s.data_publicacao,
          created_at: s.created_at,
          resumo: s.resumo,
          score: res.score,
          reasons: res.reasons,
        });
        persist.push({ search_id: s.id, score: res.score, reasons: res.reasons, categories: res.categories });
      }
    }
    matches.sort((a, b) => b.score - a.score);

    // Persistir oportunidades (idempotente por (property_id, active_search_id)).
    if (persist.length > 0) {
      // Buscar existentes para decidir insert vs update sem duplicar.
      const { data: existing } = await supabase
        .from("match_opportunities")
        .select("id, active_search_id, score")
        .eq("user_id", userId)
        .eq("property_id", prop.id);
      const existingMap = new Map<string, { id: string; score: number }>(
        (existing ?? []).map((e: any) => [e.active_search_id, { id: e.id, score: e.score }]),
      );
      for (const m of persist) {
        const prev = existingMap.get(m.search_id);
        if (!prev) {
          await supabase.from("match_opportunities").insert({
            user_id: userId,
            property_id: prop.id,
            active_search_id: m.search_id,
            score: m.score,
            reasons: m.reasons,
            categories: m.categories,
          });
        } else if (prev.score !== m.score) {
          // Alteração relevante — mantém id, reabre para revisão.
          await supabase
            .from("match_opportunities")
            .update({ score: m.score, reasons: m.reasons, categories: m.categories, viewed_at: null })
            .eq("id", prev.id);
        }
      }
    }

    return { property: { id: prop.id, referencia: prop.referencia }, matches };
  });

// Lista oportunidades por visualizar + recentes, para o Radar.
export const listOpportunities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await purgeExpired(supabase, userId);
    const { data, error } = await supabase
      .from("match_opportunities")
      .select(
        "id, score, reasons, viewed_at, created_at, updated_at, property_id, active_search_id, properties(id, referencia, tipo_imovel, tipologia, zona, freguesia, concelho, preco, finalidade), active_searches(id, contact_nome, contact_telefone, contact_grupo, resumo, criteria)",
      )
      .eq("user_id", userId)
      .order("viewed_at", { ascending: true, nullsFirst: true })
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    // Release 1.2.1 — REVALIDAÇÃO OBRIGATÓRIA em tempo real. Nunca confiamos
    // no que está persistido: cada oportunidade é re-executada nos Hard
    // Filters actuais. Se deixar de passar, apagamos a linha e não devolvemos.
    const rows = data ?? [];
    const staleIds: string[] = [];
    const valid: typeof rows = [];
    const zoneContext = await loadZoneContext();
    for (const row of rows) {
      const p = (row as any).properties;
      const s = (row as any).active_searches;
      if (!p || !s) {
        staleIds.push(row.id);
        continue;
      }
      const buyer = criteriaToBuyer(s.criteria as ActiveSearchCriteria);
      // Aumentar com dados de área/preço vindos do imóvel completo
      const { data: fullProp } = await supabase
        .from("properties")
        .select("area_util_m2, area_m2, quartos, garagem, elevador, jardim, piscina")
        .eq("id", p.id)
        .maybeSingle();
      const propFull = { ...p, ...(fullProp ?? {}) };
      const res = scoreMatch(buyer, propFull, { zoneContext });
      if (!res.compatible || res.score < 60) {
        staleIds.push(row.id);
        continue;
      }
      valid.push({ ...row, score: res.score, reasons: res.reasons } as any);
    }
    if (staleIds.length > 0) {
      // Fire-and-forget cleanup — não bloqueia a resposta.
      void supabase.from("match_opportunities").delete().in("id", staleIds).eq("user_id", userId);
    }
    return { opportunities: valid };
  });

// Contagem de oportunidades por visualizar (para o badge do menu).
export const countUnseenOpportunities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { count, error } = await supabase
      .from("match_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("viewed_at", null);
    if (error) throw new Error(error.message);
    return { unseen: count ?? 0 };
  });

// Marca todas as oportunidades por visualizar como vistas.
export const markOpportunitiesViewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("match_opportunities")
      .update({ viewed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("viewed_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Recalcula oportunidades para uma Procura Ativa recém-criada/atualizada,
// contra todos os imóveis ativos do utilizador.
export const recomputeOpportunitiesForSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ searchId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: s } = await supabase
      .from("active_searches")
      .select("id, criteria")
      .eq("id", data.searchId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!s) return { created: 0 };

    const { data: props } = await supabase
      .from("properties")
      .select(
        "id, tipo_imovel, tipologia, distrito, concelho, freguesia, zona, preco, area_util_m2, area_m2, quartos, garagem, elevador, jardim, piscina, finalidade",
      )
      .eq("user_id", userId)
      .eq("ativo", true);

    const buyer = criteriaToBuyer(s.criteria as ActiveSearchCriteria);
    const { data: existing } = await supabase
      .from("match_opportunities")
      .select("id, property_id, score")
      .eq("user_id", userId)
      .eq("active_search_id", s.id);
    const existingMap = new Map<string, { id: string; score: number }>(
      (existing ?? []).map((e: any) => [e.property_id, { id: e.id, score: e.score }]),
    );

    let created = 0;
    const zoneContext = await loadZoneContext();
    for (const p of props ?? []) {
      const r = scoreMatch(buyer, p, { zoneContext });
      if (!r.compatible || r.score < 60) continue;
      const prev = existingMap.get(p.id);
      if (!prev) {
        await supabase.from("match_opportunities").insert({
          user_id: userId,
          property_id: p.id,
          active_search_id: s.id,
          score: r.score,
          reasons: r.reasons,
          categories: r.categories,
        });
        created++;
      } else if (prev.score !== r.score) {
        await supabase
          .from("match_opportunities")
          .update({ score: r.score, reasons: r.reasons, categories: r.categories, viewed_at: null })
          .eq("id", prev.id);
      }
    }
    return { created };
  });