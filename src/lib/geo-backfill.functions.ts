// Sprint 1.2.2 — Backfill Geográfico
//
// Reprocessa properties e active_searches existentes convertendo os campos
// textuais (distrito, concelho, freguesia, zona/municipio) em IDs
// canónicos via o parser único (`parseLocations` + LocationRepository).
// Nunca duplica lógica geográfica em SQL — reutiliza exactamente o mesmo
// pipeline usado pelos importadores.
//
// Depois de reidratar a base geográfica, expõe `recomputeAllMatches` para
// reexecutar o Motor Match sobre todas as procuras ativas do utilizador.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(`Falha a validar permissões: ${error.message}`);
  if (!data) throw new Error("Apenas administradores podem executar o backfill.");
}

function topN(arr: string[], n = 30): Array<{ text: string; count: number }> {
  const counts = new Map<string, number>();
  for (const t of arr) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([text, count]) => ({ text, count }));
}

export type BackfillGeoResult = {
  properties: { total: number; resolved: number; unresolved: number; top_unresolved: Array<{ text: string; count: number }> };
  searches: { total: number; resolved: number; unresolved: number; top_unresolved: Array<{ text: string; count: number }> };
  geo_library_version: number;
};

export const backfillGeoFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BackfillGeoResult> => {
    await assertAdmin(context.supabase, context.userId);

    const { LocationRepository } = await import("./geo/location-repository");
    const { fetchAllRows } = await import("./geo/location-repository");
    const { resolveRecordLocation } = await import("./geo/geo-resolve-record");
    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    const supabaseAdmin = context.supabase as any;

    const snap = await LocationRepository.getSnapshot(true);

    // -------- Properties --------
    // Paginado: o Data API trunca em 1000 linhas por pedido.
    const props = await fetchAllRows(
      supabaseAdmin,
      "properties",
      "id, distrito, concelho, freguesia, zona",
      (q: any) => q.is("location_id", null),
    );

    let propsResolved = 0;
    let propsUnresolved = 0;
    const unresolvedPropTexts: string[] = [];
    const propUpdates: Array<() => Promise<unknown>> = [];

    for (const p of (props ?? []) as Array<{ id: string; distrito: string | null; concelho: string | null; freguesia: string | null; zona: string | null }>) {
      const res = resolveRecordLocation(
        { distrito: p.distrito, concelho: p.concelho, freguesia: p.freguesia, zona: p.zona },
        snap,
      );
      const matched = res.location_id;
      if (matched) {
        propsResolved++;
        propUpdates.push(() =>
          Promise.resolve(supabaseAdmin
            .from("properties")
            .update({ location_id: matched, geo_library_version: snap.version })
            .eq("id", p.id)),
        );
      } else {
        propsUnresolved++;
        if (res.unresolved_text) unresolvedPropTexts.push(res.unresolved_text);
      }
    }
    // Executar em paralelo (chunks) para evitar timeout.
    await runChunks(propUpdates, 20);

    // -------- Active searches --------
    const searches = await fetchAllRows(
      supabaseAdmin,
      "active_searches",
      "id, criteria, location_ids",
    );

    let searchesResolved = 0;
    let searchesUnresolved = 0;
    const unresolvedSearchTexts: string[] = [];
    const searchUpdates: Array<() => Promise<unknown>> = [];

    for (const s of (searches ?? []) as Array<{ id: string; criteria: any; location_ids: string[] | null }>) {
      const current = (s.location_ids ?? []) as string[];
      if (current.length > 0) continue; // já resolvido
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
      if (res.location_ids.length > 0) {
        searchesResolved++;
        searchUpdates.push(() =>
          Promise.resolve(supabaseAdmin
            .from("active_searches")
            .update({ location_ids: res.location_ids })
            .eq("id", s.id)),
        );
      } else if (res.unresolved_text) {
        searchesUnresolved++;
        unresolvedSearchTexts.push(res.unresolved_text);
      }
    }
    await runChunks(searchUpdates, 20);


    return {
      properties: {
        total: (props ?? []).length,
        resolved: propsResolved,
        unresolved: propsUnresolved,
        top_unresolved: topN(unresolvedPropTexts),
      },
      searches: {
        total: (searches ?? []).length,
        resolved: searchesResolved,
        unresolved: searchesUnresolved,
        top_unresolved: topN(unresolvedSearchTexts),
      },
      geo_library_version: snap.version,
    };
  });

async function runChunks(makers: Array<() => Promise<unknown>>, size: number): Promise<void> {
  for (let i = 0; i < makers.length; i += size) {
    await Promise.all(makers.slice(i, i + size).map((fn) => fn()));
  }
}

export type RecomputeAllResult = {
  searches_processed: number;
  opportunities_created: number;
};

export const recomputeAllMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RecomputeAllResult> => {
    await assertAdmin(context.supabase, context.userId);

    const { setRequestClient } = await import("@/lib/privileged.server");
    setRequestClient(context.supabase);
    const supabaseAdmin = context.supabase as any;
    const { recomputeForBatch } = await import("./active-searches.functions");
    const { fetchAllRows } = await import("./geo/location-repository");

    const nowIso = new Date().toISOString();
    // Reprocessar apenas procuras ativas (não expiradas) de todos os utilizadores.
    const rows = await fetchAllRows(
      supabaseAdmin,
      "active_searches",
      "id, user_id",
      (q: any) => q.gt("expires_at", nowIso),
    );

    const byUser = new Map<string, string[]>();
    for (const r of (rows ?? []) as Array<{ id: string; user_id: string }>) {
      const arr = byUser.get(r.user_id) ?? [];
      arr.push(r.id);
      byUser.set(r.user_id, arr);
    }

    let created = 0;
    let processed = 0;
    const CHUNK = 200;
    for (const [uid, ids] of byUser) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const res = await recomputeForBatch(context.supabase, uid, slice);
        created += res.created ?? 0;
        processed += slice.length;
      }
    }
    return { searches_processed: processed, opportunities_created: created };
  });