// Release 1.3.1 — Backfill de categoria dos IMÓVEIS.
//
// Reutiliza exactamente a mesma inferência determinística usada pelos pontos de
// escrita (`inferPropertyCategory`), com modo de simulação obrigatório antes de
// gravar. Nunca sobrepõe uma categoria já existente.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  inferPropertyCategory,
  type PropertyCategoryOrigin,
} from "./property-category-infer";

async function assertAdmin(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(`Falha a validar permissões: ${error.message}`);
  if (!data) throw new Error("Apenas administradores podem executar o backfill de categorias.");
}

export type PropertyCategoryBackfillSample = {
  id: string;
  referencia: string | null;
  zona: string | null;
  tipo_imovel: string | null;
  subtipo_imovel: string | null;
  tipologia: string | null;
  texto: string | null;
  antes: string | null;
  depois: string | null;
  decisao: PropertyCategoryOrigin;
  sinais: string[];
};

export type PropertyCategoryBackfillResult = {
  applied: boolean;
  total_ativos: number;
  total_sem_categoria: number;
  por_origem: Record<PropertyCategoryOrigin, number>;
  indecidiveis: number;
  atualizados: number;
  amostra: PropertyCategoryBackfillSample[];
};

const Input = z.object({
  apply: z.boolean().default(false),
  sample: z.number().int().min(1).max(200).default(40),
});

export const runPropertyCategoryBackfill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<PropertyCategoryBackfillResult> => {
    await assertAdmin(context.supabase, context.userId);

    const { fetchAllRows } = await import("./geo/location-repository");
    const db = context.supabase as any;

    const rows = (await fetchAllRows(
      db,
      "properties",
      "id, referencia, zona, categoria, tipo_imovel, subtipo_imovel, tipologia, descricao, caracteristicas",
      (q: any) => q.eq("ativo", true),
    )) as Array<Record<string, any>>;

    const por_origem: Record<PropertyCategoryOrigin, number> = {
      existente: 0,
      tipo_imovel: 0,
      tipologia: 0,
      inferido_texto: 0,
      indecidivel: 0,
    };
    const amostra: PropertyCategoryBackfillSample[] = [];
    const updates: Array<{ id: string; categoria: string }> = [];
    let total_sem_categoria = 0;
    let indecidiveis = 0;

    for (const r of rows ?? []) {
      const antes = typeof r.categoria === "string" && r.categoria ? r.categoria : null;
      // Regra dura: nunca sobrepor valor já existente.
      if (antes) continue;
      total_sem_categoria++;

      const res = inferPropertyCategory({
        categoria: null,
        tipo_imovel: r.tipo_imovel,
        subtipo_imovel: r.subtipo_imovel,
        tipologia: r.tipologia,
        referencia: r.referencia,
        descricao: r.descricao,
        caracteristicas: r.caracteristicas,
      });

      por_origem[res.origem]++;
      if (!res.categoria) indecidiveis++;

      if (amostra.length < data.sample) {
        amostra.push({
          id: r.id,
          referencia: r.referencia ?? null,
          zona: r.zona ?? null,
          tipo_imovel: r.tipo_imovel ?? null,
          subtipo_imovel: r.subtipo_imovel ?? null,
          tipologia: r.tipologia ?? null,
          texto: (`${r.descricao ?? ""} ${r.caracteristicas ?? ""}`.trim().slice(0, 180)) || null,
          antes,
          depois: res.categoria,
          decisao: res.origem,
          sinais: res.sinais,
        });
      }

      if (res.categoria) updates.push({ id: r.id, categoria: res.categoria });
    }

    let atualizados = 0;
    if (data.apply) {
      const CHUNK = 25;
      for (let i = 0; i < updates.length; i += CHUNK) {
        await Promise.all(
          updates.slice(i, i + CHUNK).map(async (u) => {
            const { error } = await db
              .from("properties")
              .update({ categoria: u.categoria })
              .eq("id", u.id);
            if (!error) atualizados++;
          }),
        );
      }
    }

    return {
      applied: data.apply,
      total_ativos: rows?.length ?? 0,
      total_sem_categoria,
      por_origem,
      indecidiveis,
      atualizados,
      amostra,
    };
  });
