// B3 — Backfill retroativo do enriquecimento geográfico a partir do texto
// original. Reutiliza EXACTAMENTE o núcleo puro `enrichRecordGeo` usado pela
// ingestão (nunca duplica lógica geográfica).
//
// "Simular" nunca escreve. "Aplicar" grava apenas a classe `preenche`;
// `divergencia` e `baixa_confianca` vão para a lista de revisão manual.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { GeoEnrichClass } from "./geo/geo-enrich-from-text";

async function assertAdmin(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(`Falha a validar permissões: ${error.message}`);
  if (!data) throw new Error("Apenas administradores podem executar este backfill.");
}

export type GeoEnrichCounts = Record<GeoEnrichClass, number>;

export type GeoEnrichSample = {
  id: string;
  etiqueta: string | null;
  texto: string;
  campos: string;
  antes: string;
  depois: string;
  classe: GeoEnrichClass;
  confianca: number;
  motivo: string;
};

export type GeoTextEnrichResult = {
  applied: boolean;
  min_confidence: number;
  total: number;
  atualizados: number;
  counts: GeoEnrichCounts;
  /** Distribuição da classe `preenche` por distrito. */
  por_distrito: Array<{ distrito: string; preenche: number; divergencia: number }>;
  amostra: GeoEnrichSample[];
  /** Lista completa das divergências + baixa confiança (para exportar CSV). */
  divergencias: GeoEnrichSample[];
  recompute: { procuras: number; oportunidades: number } | null;
  geo_library_version: number;
};

const Input = z.object({
  apply: z.boolean().default(false),
  min_confidence: z.number().int().min(50).max(100).default(90),
  sample: z.number().int().min(1).max(200).default(40),
});

const emptyCounts = (): GeoEnrichCounts => ({
  mantem: 0,
  preenche: 0,
  divergencia: 0,
  baixa_confianca: 0,
  sem_info: 0,
});

export const backfillGeoFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<GeoTextEnrichResult> => {
    await assertAdmin(context.supabase, context.userId);

    const { LocationRepository, fetchAllRows } = await import("./geo/location-repository");
    const { enrichRecordGeo } = await import("./geo/geo-enrich-from-text");
    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    const db = context.supabase as any;

    const snap = await LocationRepository.getSnapshot(true);
    const nome = (id: string | null) =>
      id ? `${snap.byId.get(id)?.nome ?? "?"} (${snap.byId.get(id)?.tipo ?? "?"})` : "—";

    const rows = (await fetchAllRows(
      db,
      "active_searches",
      "id, user_id, criteria, location_ids, texto_original, resumo, contact_nome, consultor_nome",
    )) as Array<Record<string, any>>;

    const counts = emptyCounts();
    const amostra: GeoEnrichSample[] = [];
    const divergencias: GeoEnrichSample[] = [];
    const porDistrito = new Map<string, { preenche: number; divergencia: number }>();
    const updates: Array<{ id: string; user_id: string; location_ids: string[] }> = [];
    let total = 0;

    for (const s of rows ?? []) {
      total++;
      const c = (s.criteria ?? {}) as Record<string, any>;
      const fields = {
        distrito: c.distrito ?? null,
        concelho: c.municipio ?? c.concelho ?? null,
        freguesia: c.freguesia ?? null,
        zona: c.zona ?? null,
      };
      const current: string[] = Array.isArray(s.location_ids) ? s.location_ids : [];
      const en = enrichRecordGeo(
        { fields, texto: s.texto_original ?? s.resumo ?? null, current_ids: current },
        snap,
        { minConfidence: data.min_confidence },
      );
      counts[en.classe]++;

      const dNome = en.distrito_nome ?? "(sem distrito)";
      if (en.classe === "preenche" || en.classe === "divergencia") {
        const agg = porDistrito.get(dNome) ?? { preenche: 0, divergencia: 0 };
        if (en.classe === "preenche") agg.preenche++;
        else agg.divergencia++;
        porDistrito.set(dNome, agg);
      }

      const linha: GeoEnrichSample = {
        id: s.id,
        etiqueta: s.contact_nome ?? s.consultor_nome ?? null,
        texto: (s.texto_original ?? s.resumo ?? "").toString().slice(0, 240),
        campos: [fields.distrito, fields.concelho, fields.freguesia, fields.zona]
          .filter(Boolean)
          .join(" / "),
        antes: current.length ? current.map(nome).join(", ") : "—",
        depois: en.location_ids.length ? en.location_ids.map(nome).join(", ") : "—",
        classe: en.classe,
        confianca: en.confidence,
        motivo:
          en.motivo ??
          (en.candidates.length ? `candidatos: ${en.candidates.map((k) => k.nome).join(", ")}` : ""),
      };
      if (en.classe === "divergencia" || en.classe === "baixa_confianca") divergencias.push(linha);
      if (en.classe !== "mantem" && en.classe !== "sem_info" && amostra.length < data.sample) {
        amostra.push(linha);
      }
      if (en.classe === "preenche") {
        updates.push({ id: s.id, user_id: s.user_id, location_ids: en.location_ids });
      }
    }

    let atualizados = 0;
    let recompute: GeoTextEnrichResult["recompute"] = null;

    if (data.apply && updates.length > 0) {
      for (let i = 0; i < updates.length; i += 20) {
        const slice = updates.slice(i, i + 20);
        await Promise.all(
          slice.map(async (u) => {
            const { error } = await db
              .from("active_searches")
              .update({ location_ids: u.location_ids, geo_library_version: snap.version })
              .eq("id", u.id);
            if (!error) atualizados++;
          }),
        );
      }

      const { recomputeForBatch } = await import("./active-searches.functions");
      const owners = new Set(updates.map((u) => u.user_id));
      const nowIso = new Date().toISOString();
      let procs = 0;
      let opps = 0;
      for (const uid of owners) {
        const own = (await fetchAllRows(db, "active_searches", "id", (q: any) =>
          q.eq("user_id", uid).gt("expires_at", nowIso),
        )) as Array<{ id: string }>;
        const ids = (own ?? []).map((r) => r.id);
        for (let i = 0; i < ids.length; i += 200) {
          const slice = ids.slice(i, i + 200);
          const r = await recomputeForBatch(context.supabase, uid, slice);
          opps += r.created ?? 0;
          procs += slice.length;
        }
      }
      recompute = { procuras: procs, oportunidades: opps };
    }

    return {
      applied: data.apply,
      min_confidence: data.min_confidence,
      total,
      atualizados,
      counts,
      por_distrito: [...porDistrito.entries()]
        .map(([distrito, v]) => ({ distrito, ...v }))
        .sort((a, b) => b.preenche - a.preenche),
      amostra,
      divergencias,
      recompute,
      geo_library_version: snap.version,
    };
  });
