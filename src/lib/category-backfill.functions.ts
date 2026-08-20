// Release 1.2.12 — Backfill único de categorias das procuras ativas.
//
// Reutiliza exactamente a mesma inferência determinística usada pelos
// importadores (`inferSearchCategories`), com modo de simulação obrigatório
// antes de escrever.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { inferSearchCategories, type CategoryOrigin } from "./category-infer";

async function assertAdmin(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(`Falha a validar permissões: ${error.message}`);
  if (!data) throw new Error("Apenas administradores podem executar o backfill de categorias.");
}

export type CategoryBackfillSample = {
  id: string;
  nome: string | null;
  origem: string;
  tipo_imovel: string[] | null;
  tipologia: string | null;
  texto: string | null;
  antes: string[] | null;
  depois: string[];
  decisao: CategoryOrigin;
};

export type CategoryBackfillResult = {
  applied: boolean;
  total_sem_categorias: number;
  por_origem: Record<CategoryOrigin, number>;
  atualizadas: number;
  amostra: CategoryBackfillSample[];
};

const Input = z.object({ apply: z.boolean().default(false), sample: z.number().int().min(1).max(200).default(40) });

export const runCategoryBackfill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<CategoryBackfillResult> => {
    await assertAdmin(context.supabase, context.userId);

    const { fetchAllRows } = await import("./geo/location-repository");
    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    const db = context.supabase as any;

    const rows = (await fetchAllRows(
      db,
      "active_searches",
      "id, origem, criteria, texto_original, resumo",
    )) as Array<{ id: string; origem: string; criteria: any; texto_original: string | null; resumo: string | null }>;

    const por_origem: Record<CategoryOrigin, number> = {
      existente: 0,
      tipo_imovel: 0,
      tipologia: 0,
      inferido_texto: 0,
      indecidivel: 0,
    };
    const amostra: CategoryBackfillSample[] = [];
    const updates: Array<{ id: string; criteria: any }> = [];

    for (const r of rows ?? []) {
      const c = (r.criteria ?? {}) as Record<string, unknown>;
      const antes = Array.isArray(c.categorias) ? (c.categorias as string[]) : null;
      // Regra dura: nunca sobrepor valor já existente.
      if (antes && antes.length > 0 && typeof c.categoria_origem === "string") continue;

      const res = inferSearchCategories({
        categorias: antes,
        tipo_imovel: c.tipo_imovel,
        tipologia: c.tipologia,
        texto_original: r.texto_original,
        resumo: r.resumo,
      });
      por_origem[res.categoria_origem]++;
      if (amostra.length < data.sample) {
        amostra.push({
          id: r.id,
          nome: (c.nome as string) ?? null,
          origem: r.origem,
          tipo_imovel: Array.isArray(c.tipo_imovel) ? (c.tipo_imovel as string[]) : null,
          tipologia: (c.tipologia as string) ?? null,
          texto: (r.texto_original ?? r.resumo ?? "").slice(0, 180) || null,
          antes,
          depois: res.categorias,
          decisao: res.categoria_origem,
        });
      }
      updates.push({
        id: r.id,
        criteria: {
          ...c,
          categorias: res.categorias.length > 0 ? res.categorias : null,
          categoria_origem: res.categoria_origem,
        },
      });
    }

    let atualizadas = 0;
    if (data.apply) {
      const CHUNK = 25;
      for (let i = 0; i < updates.length; i += CHUNK) {
        await Promise.all(
          updates.slice(i, i + CHUNK).map(async (u) => {
            const { error } = await db.from("active_searches").update({ criteria: u.criteria }).eq("id", u.id);
            if (!error) atualizadas++;
          }),
        );
      }
    }

    return {
      applied: data.apply,
      total_sem_categorias: updates.length,
      por_origem,
      atualizadas,
      amostra,
    };
  });
