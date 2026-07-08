import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scoreMatch, type BuyerLike } from "./matching-engine";

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
});

export type ActiveSearchCriteria = z.infer<typeof CriteriaSchema>;

const SaveInput = z.object({
  criteria: CriteriaSchema,
  resumo: z.string().nullable().optional(),
  texto_original: z.string().nullable().optional(),
  contact_nome: z.string().nullable().optional(),
  contact_telefone: z.string().nullable().optional(),
  contact_grupo: z.string().nullable().optional(),
  data_publicacao: z.string().nullable().optional(),
  duration_days: z.number().int().min(1).max(60).default(14),
});

export const saveActiveSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SaveInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const expires = new Date(Date.now() + data.duration_days * 24 * 60 * 60 * 1000).toISOString();
    const { data: row, error } = await supabase
      .from("active_searches")
      .insert({
        user_id: userId,
        criteria: data.criteria,
        resumo: data.resumo ?? null,
        texto_original: data.texto_original ?? null,
        contact_nome: data.contact_nome ?? null,
        contact_telefone: data.contact_telefone ?? null,
        contact_grupo: data.contact_grupo ?? null,
        data_publicacao: data.data_publicacao ?? null,
        expires_at: expires,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, expires_at: row.expires_at };
  });

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