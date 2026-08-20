// ---------------------------------------------------------------------------
// Painel de Duplicados (retroativo) — Manutenção
//
// A dedup em tempo de importação já foi reforçada (telefone efetivo + nome +
// texto idêntico). Este painel trata os duplicados JÁ criados em produção
// antes dessa correção: agrupa procuras da mesma pessoa e permite fundir
// manualmente, ou marcar o grupo como "manter separado" (decisão persistida
// em app_settings, para o grupo não voltar a aparecer).
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminContext } from "./admin-guard.server";
import { normalizePhone, normalizeTextKey, textJaccard } from "./dedup";
import {
  KEEP_SEPARATE_KEY,
  completeness,
  readKeepSeparate,
  type DuplicateGroup,
  type DuplicateMember,
} from "./duplicates.server";

export type { DuplicateGroup, DuplicateMember };
import { normContactName } from "./contacts.server";
import { recomputeForSearch } from "./active-searches.functions";

export type MergePreview = {
  aplicado: boolean;
  mantida: { id: string; user_id: string; nome: string | null; origem: string | null };
  remover: number;
  apagadas: number;
  oportunidades_removidas: number;
  notificacoes_removidas: number;
  estados_removidos: number;
  amostra: Array<{
    id: string;
    nome: string | null;
    origem: string | null;
    criada_em: string | null;
    oportunidades: number;
    notificacoes: number;
    estados: number;
  }>;
};

export const listDuplicateGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ grupos: DuplicateGroup[]; total_excedentes: number }> => {
    await assertAdminContext(context);
    const { supabase } = context;
    const keepSeparate = await readKeepSeparate(supabase);

    const rows: any[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("active_searches")
        .select(
          "id, user_id, criteria, contact_nome, contact_telefone, consultor_nome, consultor_telefone, texto_original, resumo, created_at, data_origem, origem, matches_count, location_ids",
        )
        .eq("descartado", false)
        // Release 1.2.5 — procuras expiradas não entram na vista de duplicados.
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }

    const groups = new Map<string, { pessoa: string; telefone: string | null; tipo: "telefone" | "nome"; rows: any[] }>();
    for (const r of rows) {
      const tel = normalizePhone(r.contact_telefone) ?? normalizePhone(r.consultor_telefone);
      const nome = normContactName(r.contact_nome ?? r.consultor_nome);
      const key = tel ? `${r.user_id}::tel:${tel}` : nome ? `${r.user_id}::nome:${nome}` : null;
      if (!key) continue;
      if (!groups.has(key)) {
        groups.set(key, {
          pessoa: (r.contact_nome ?? r.consultor_nome ?? "(sem nome)") as string,
          telefone: tel,
          tipo: tel ? "telefone" : "nome",
          rows: [],
        });
      }
      groups.get(key)!.rows.push(r);
    }

    const out: DuplicateGroup[] = [];
    let totalExcedentes = 0;
    for (const [key, g] of groups) {
      if (g.rows.length < 2) continue;
      if (keepSeparate.has(key)) continue;

      // Só consideramos duplicado o que tem texto original semelhante entre si:
      // a mesma pessoa pode legitimamente ter necessidades diferentes.
      const textos = g.rows.map((r) => r.texto_original ?? r.resumo ?? "");
      const distintos = new Set(textos.map((t) => normalizeTextKey(t)).filter(Boolean));
      let sim = 1;
      if (distintos.size > 1) {
        const list = [...distintos];
        let acc = 0;
        let n = 0;
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            acc += textJaccard(list[i], list[j]);
            n++;
          }
        sim = n ? acc / n : 0;
      }
      // Grupo por nome sem telefone exige texto quase igual para ser sugerido.
      if (g.tipo === "nome" && sim < 0.8) continue;
      if (g.tipo === "telefone" && sim < 0.4) continue;

      const membros: DuplicateMember[] = g.rows
        .map((r) => ({
          id: r.id,
          criteria: r.criteria,
          contact_nome: r.contact_nome,
          consultor_nome: r.consultor_nome,
          telefone: normalizePhone(r.contact_telefone) ?? normalizePhone(r.consultor_telefone) ?? null,
          texto_original: r.texto_original,
          resumo: r.resumo,
          created_at: r.created_at,
          data_origem: r.data_origem,
          origem: r.origem,
          matches_count: r.matches_count ?? 0,
          completeness: completeness(r),
        }))
        .sort((a, b) => b.completeness - a.completeness || +new Date(b.created_at) - +new Date(a.created_at));

      totalExcedentes += membros.length - 1;
      out.push({
        key,
        pessoa: g.pessoa,
        telefone: g.telefone,
        chave_tipo: g.tipo,
        membros,
        excedentes: membros.length - 1,
        similaridade_texto: Math.round(sim * 100) / 100,
      });
    }

    out.sort((a, b) => b.excedentes - a.excedentes || a.pessoa.localeCompare(b.pessoa));
    return { grupos: out.slice(0, 300), total_excedentes: totalExcedentes };
  });

const mergeInput = (d: unknown) =>
  z
    .object({
      keep_id: z.string().uuid(),
      remove_ids: z.array(z.string().uuid()).min(1).max(200),
    })
    .parse(d);

/**
 * Simulação (não grava nada): devolve exatamente o que a fusão iria apagar —
 * procuras, oportunidades, notificações e estados de match.
 */
export const simulateMergeDuplicateGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(mergeInput)
  .handler(async ({ data, context }): Promise<MergePreview> => {
    await assertAdminContext(context);
    const { supabase } = context;
    const { data: res, error } = await (supabase as any).rpc("admin_merge_duplicate_group", {
      p_keep_id: data.keep_id,
      p_remove_ids: data.remove_ids.filter((id) => id !== data.keep_id),
      p_apply: false,
    });
    if (error) throw new Error(error.message);
    return res as MergePreview;
  });

/**
 * Funde um grupo: mantém `keep_id`, elimina os restantes (incluindo
 * notificações e estados de match, para não deixar órfãos) e recruza o mantido.
 * Só o conteúdo da procura mantida sobrevive — intencional.
 */
export const mergeDuplicateGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(mergeInput)
  .handler(async ({ data, context }): Promise<MergePreview & { removidas: number; keep_id: string }> => {
    await assertAdminContext(context);
    const { supabase } = context;
    const removeIds = data.remove_ids.filter((id) => id !== data.keep_id);
    const { data: res, error } = await (supabase as any).rpc("admin_merge_duplicate_group", {
      p_keep_id: data.keep_id,
      p_remove_ids: removeIds,
      p_apply: true,
    });
    if (error) throw new Error(error.message);
    const out = res as MergePreview;

    try {
      await recomputeForSearch(supabase, out.mantida.user_id, out.mantida.id);
    } catch (e) {
      console.error("[duplicados] recompute falhou", e);
    }
    return { ...out, removidas: out.apagadas, keep_id: out.mantida.id };
  });

/** Marca um grupo como legítimo (não é duplicado) — deixa de ser sugerido. */
export const keepDuplicateGroupSeparate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.string().min(3) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdminContext(context);
    const { supabase, userId } = context;
    const current = await readKeepSeparate(supabase);
    current.add(data.key);
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key: KEEP_SEPARATE_KEY, value: [...current], updated_by: userId },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
