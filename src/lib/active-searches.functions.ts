import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scoreMatch, type BuyerLike } from "./matching-engine";
import { buildDedupKey, normalizePhone, scoreSimilarity, type SimilarityCriteria } from "./dedup";

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
});

export const saveActiveSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SaveInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const expires = new Date(Date.now() + data.duration_days * 24 * 60 * 60 * 1000).toISOString();
    const dedup_key = buildDedupKey({
      telefone: data.contact_telefone,
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
      contact_telefone: data.contact_telefone ?? null,
      contact_email: data.contact_email ?? null,
      contact_grupo: data.contact_grupo ?? null,
      data_publicacao: data.data_publicacao ?? null,
      expires_at: expires,
      origem: data.origem,
      import_batch_id: null,
    });
    return {
      id: res.id,
      expires_at: res.expires_at,
      action: res.action,
      similarity: res.similarity,
      flagged_for_review: res.flagged_for_review,
    };
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
    .select("id, criteria, contact_nome, contact_email, contact_grupo, contact_telefone, texto_original, resumo, data_publicacao, merged_from_count")
    .eq("user_id", userId)
    .ilike("contact_telefone", `%${phone}%`)
    .limit(100);

  const candidates = (rawCandidates ?? []).filter(
    (c: any) => normalizePhone(c.contact_telefone) === phone,
  );

  if (candidates.length === 0) {
    return await insertNew(supabase, userId, row, 0, "sem candidato compatível", "created");
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
  if (bestScore >= 95) {
    return await mergeInto(
      supabase,
      userId,
      best.id,
      best,
      row,
      bestScore,
      `duplicado exato (${bestScore}%): ${reasonSummary}`,
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
    if (ai.decision === "update") {
      return await mergeInto(
        supabase,
        userId,
        best.id,
        best,
        row,
        bestScore,
        `IA fundir (${bestScore}%): ${ai.reason} | ${reasonSummary}`,
      );
    }
    if (ai.decision === "review") {
      return await insertNew(
        supabase,
        userId,
        row,
        bestScore,
        `IA em dúvida (${bestScore}%): ${ai.reason} | ${reasonSummary}`,
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
    budget_min: c.budget_min ?? null,
    budget_max: c.budget_max ?? null,
    area_min: c.area_min ?? null,
    quartos_min: c.quartos_min ?? null,
    garagem_obrigatoria: gar,
    elevador_obrigatorio: ele,
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
    for (const s of searches ?? []) {
      const buyer = criteriaToBuyer(s.criteria as ActiveSearchCriteria);
      const res = scoreMatch(buyer, prop);
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
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return { property: { id: prop.id, referencia: prop.referencia }, matches };
  });