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

/** Funde um grupo: mantém `keep_id`, elimina os restantes e recruza o mantido. */
export const mergeDuplicateGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        keep_id: z.string().uuid(),
        remove_ids: z.array(z.string().uuid()).min(1).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ removidas: number; keep_id: string }> => {
    await assertAdminContext(context);
    const { supabase } = context;
    const removeIds = data.remove_ids.filter((id) => id !== data.keep_id);
    if (removeIds.length === 0) return { removidas: 0, keep_id: data.keep_id };

    const { data: keeper, error: kErr } = await supabase
      .from("active_searches")
      .select("id, user_id, merged_from_count")
      .eq("id", data.keep_id)
      .maybeSingle();
    if (kErr) throw new Error(kErr.message);
    if (!keeper) throw new Error("Procura a manter não encontrada.");

    const { error: oErr } = await supabase
      .from("match_opportunities")
      .delete()
      .in("active_search_id", removeIds);
    if (oErr) throw new Error(oErr.message);

    const { error: dErr } = await supabase.from("active_searches").delete().in("id", removeIds);
    if (dErr) throw new Error(dErr.message);

    await supabase
      .from("active_searches")
      .update({
        merged_from_count: (keeper.merged_from_count ?? 0) + removeIds.length,
        flagged_for_review: false,
      })
      .eq("id", keeper.id);

    try {
      await recomputeForSearch(supabase, keeper.user_id, keeper.id);
    } catch (e) {
      console.error("[duplicados] recompute falhou", e);
    }
    return { removidas: removeIds.length, keep_id: keeper.id };
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
