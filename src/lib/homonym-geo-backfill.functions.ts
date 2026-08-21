// Comando 3/3 — Backfill dos `location_id` errados por homónimos
// distrito/concelho (Setúbal/Setúbal, Porto/Porto, Lisboa/Lisboa, ...).
//
// Reutiliza exactamente o mesmo resolutor hierárquico dos pontos de escrita
// (`resolveRecordLocation`) — nunca duplica lógica geográfica. Simulação
// obrigatória antes de aplicar. "Aplicar" grava apenas a classe `corrige`;
// a classe `especializa` fica atrás de um segundo interruptor, desligado por
// omissão. `conflito` nunca é gravado (vai para revisão humana).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { GeoBackfillClass } from "./geo/homonym-backfill";

async function assertAdmin(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(`Falha a validar permissões: ${error.message}`);
  if (!data) throw new Error("Apenas administradores podem executar este backfill.");
}

export type HomonymSample = {
  id: string;
  tipo: "imovel" | "procura";
  etiqueta: string | null;
  texto: string;
  antes: string;
  depois: string;
  classe: GeoBackfillClass;
  descartados: string;
};

export type HomonymCounts = Record<GeoBackfillClass, number>;

export type HomonymBackfillResult = {
  applied: boolean;
  incluir_especializa: boolean;
  excluir_perda_nivel: boolean;
  imoveis: HomonymCounts & { total: number; atualizados: number; excluidos_perda_nivel: number };
  procuras: HomonymCounts & { total: number; atualizados: number };
  recompute: { procuras: number; oportunidades: number } | null;
  amostra: HomonymSample[];
  geo_library_version: number;
};

const Input = z.object({
  apply: z.boolean().default(false),
  /** Deixa de fora as mudanças freguesia → concelho (freguesia em falta na biblioteca). */
  excluir_perda_nivel: z.boolean().default(true),
  incluir_especializa: z.boolean().default(false),
  sample: z.number().int().min(1).max(200).default(40),
});

const emptyCounts = (): HomonymCounts => ({
  corrige: 0,
  especializa: 0,
  mantem: 0,
  conflito: 0,
});

export const backfillHomonymGeo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<HomonymBackfillResult> => {
    await assertAdmin(context.supabase, context.userId);

    const { LocationRepository, fetchAllRows } = await import("./geo/location-repository");
    const { resolveRecordLocation } = await import("./geo/geo-resolve-record");
    const { classifyProperty, classifySearch, losesLevel } = await import("./geo/homonym-backfill");
    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    const db = context.supabase as any;

    const snap = await LocationRepository.getSnapshot(true);
    const nome = (id: string | null) =>
      id ? `${snap.byId.get(id)?.nome ?? "?"} (${snap.byId.get(id)?.tipo ?? "?"})` : "—";

    const amostra: HomonymSample[] = [];
    const imoveis = { ...emptyCounts(), total: 0, atualizados: 0, excluidos_perda_nivel: 0 };
    const procuras = { ...emptyCounts(), total: 0, atualizados: 0 };

    const gravar = (c: GeoBackfillClass) =>
      c === "corrige" || (c === "especializa" && data.incluir_especializa);

    // -------- Imóveis --------
    const props = (await fetchAllRows(
      db,
      "properties",
      "id, user_id, referencia, distrito, concelho, freguesia, zona, location_id",
    )) as Array<Record<string, any>>;

    const propUpdates: Array<{ id: string; user_id: string; location_id: string }> = [];

    for (const p of props ?? []) {
      imoveis.total++;
      const res = resolveRecordLocation(
        { distrito: p.distrito, concelho: p.concelho, freguesia: p.freguesia, zona: p.zona },
        snap,
      );
      const classe = classifyProperty(p.location_id ?? null, res, snap);
      imoveis[classe]++;
      const perdeNivel =
        gravar(classe) && losesLevel(p.location_id ?? null, res.location_id, snap);
      if (perdeNivel && data.excluir_perda_nivel) imoveis.excluidos_perda_nivel++;
      if (classe !== "mantem" && amostra.length < data.sample) {
        amostra.push({
          id: p.id,
          tipo: "imovel",
          etiqueta: p.referencia ?? null,
          texto: [p.distrito, p.concelho, p.freguesia, p.zona].filter(Boolean).join(" / "),
          antes: nome(p.location_id ?? null),
          depois: nome(res.location_id),
          classe,
          descartados: [
            perdeNivel && data.excluir_perda_nivel ? "excluído: perde nível (freguesia em falta na biblioteca)" : "",
            res.discarded.map((d) => `${d.field}="${d.raw}" (${d.reason})`).join("; "),
          ]
            .filter(Boolean)
            .join(" · "),
        });
      }
      if (gravar(classe) && res.location_id && !(perdeNivel && data.excluir_perda_nivel)) {
        propUpdates.push({ id: p.id, user_id: p.user_id, location_id: res.location_id });
      }
    }

    // -------- Procuras --------
    const searches = (await fetchAllRows(
      db,
      "active_searches",
      "id, user_id, criteria, location_ids, contact_nome, consultor_nome",
    )) as Array<Record<string, any>>;

    const searchUpdates: Array<{ id: string; user_id: string; location_ids: string[] }> = [];

    for (const s of searches ?? []) {
      procuras.total++;
      const c = (s.criteria ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const res = resolveRecordLocation(
        {
          distrito: str(c.distrito),
          concelho: str(c.municipio),
          freguesia: str(c.freguesia),
          zona: str(c.zona),
        },
        snap,
      );
      const current = (s.location_ids ?? []) as string[];
      const classe = classifySearch(current, res, snap);
      procuras[classe]++;
      if (classe !== "mantem" && amostra.length < data.sample) {
        amostra.push({
          id: s.id,
          tipo: "procura",
          etiqueta: s.contact_nome ?? s.consultor_nome ?? null,
          texto: [str(c.distrito), str(c.municipio), str(c.freguesia), str(c.zona)]
            .filter((v) => v.length > 0)
            .join(" / "),
          antes: current.map((id) => nome(id)).join(", ") || "—",
          depois: res.location_ids.map((id) => nome(id)).join(", ") || "—",
          classe,
          descartados: res.discarded.map((d) => `${d.field}="${d.raw}" (${d.reason})`).join("; "),
        });
      }
      if (gravar(classe) && res.location_ids.length > 0) {
        searchUpdates.push({ id: s.id, user_id: s.user_id, location_ids: res.location_ids });
      }
    }

    let recompute: HomonymBackfillResult["recompute"] = null;

    if (data.apply) {
      const CHUNK = 25;
      for (let i = 0; i < propUpdates.length; i += CHUNK) {
        await Promise.all(
          propUpdates.slice(i, i + CHUNK).map(async (u) => {
            const { error } = await db
              .from("properties")
              .update({ location_id: u.location_id, geo_library_version: snap.version })
              .eq("id", u.id);
            if (!error) imoveis.atualizados++;
          }),
        );
      }
      for (let i = 0; i < searchUpdates.length; i += CHUNK) {
        await Promise.all(
          searchUpdates.slice(i, i + CHUNK).map(async (u) => {
            const { error } = await db
              .from("active_searches")
              .update({ location_ids: u.location_ids, geo_library_version: snap.version })
              .eq("id", u.id);
            if (!error) procuras.atualizados++;
          }),
        );
      }

      // Recompute dos matches apenas dos donos afetados.
      const owners = new Set<string>([
        ...propUpdates.map((u) => u.user_id),
        ...searchUpdates.map((u) => u.user_id),
      ]);
      if (owners.size > 0) {
        const { recomputeForBatch } = await import("./active-searches.functions");
        const nowIso = new Date().toISOString();
        let procs = 0;
        let opps = 0;
        for (const uid of owners) {
          const rows = (await fetchAllRows(db, "active_searches", "id", (q: any) =>
            q.eq("user_id", uid).gt("expires_at", nowIso),
          )) as Array<{ id: string }>;
          const ids = (rows ?? []).map((r) => r.id);
          for (let i = 0; i < ids.length; i += 200) {
            const slice = ids.slice(i, i + 200);
            const r = await recomputeForBatch(context.supabase, uid, slice);
            opps += r.created ?? 0;
            procs += slice.length;
          }
        }
        recompute = { procuras: procs, oportunidades: opps };
      }
    }

    return {
      applied: data.apply,
      excluir_perda_nivel: data.excluir_perda_nivel,
      incluir_especializa: data.incluir_especializa,
      imoveis,
      procuras,
      recompute,
      amostra,
      geo_library_version: snap.version,
    };
  });
