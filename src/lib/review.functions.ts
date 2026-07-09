import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recomputeForSearch } from "./active-searches.functions";
import { buildDedupKey } from "./dedup";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Apenas administradores.");
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