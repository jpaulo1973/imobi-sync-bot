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
    const { parseLocations } = await import("./geo");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const snap = await LocationRepository.getSnapshot(true);

    // -------- Properties --------
    const { data: props, error: propsErr } = await supabaseAdmin
      .from("properties")
      .select("id, distrito, concelho, freguesia, zona")
      .is("location_id", null);
    if (propsErr) throw new Error(`Leitura de properties falhou: ${propsErr.message}`);

    let propsResolved = 0;
    let propsUnresolved = 0;
    const unresolvedPropTexts: string[] = [];
    const propUpdates: Array<Promise<unknown>> = [];

    for (const p of (props ?? []) as Array<{ id: string; distrito: string | null; concelho: string | null; freguesia: string | null; zona: string | null }>) {
      const candidates = [p.freguesia, p.concelho, p.zona, p.distrito]
        .map((v) => (v ?? "").trim())
        .filter((v) => v.length > 0);
      let matched: string | null = null;
      for (const t of candidates) {
        const r = parseLocations(t, snap);
        if (r.resolved.length > 0) { matched = r.resolved[0]; break; }
      }
      if (matched) {
        propsResolved++;
        propUpdates.push(
          supabaseAdmin
            .from("properties")
            .update({ location_id: matched, geo_library_version: snap.version })
            .eq("id", p.id),
        );
      } else {
        propsUnresolved++;
        if (candidates[0]) unresolvedPropTexts.push(candidates[0]);
      }
    }
    // Executar em paralelo (chunks) para evitar timeout.
    await runChunks(propUpdates, 20);

    // -------- Active searches --------
    const { data: searches, error: seErr } = await supabaseAdmin
      .from("active_searches")
      .select("id, criteria, location_ids");
    if (seErr) throw new Error(`Leitura de active_searches falhou: ${seErr.message}`);

    let searchesResolved = 0;
    let searchesUnresolved = 0;
    const unresolvedSearchTexts: string[] = [];
    const searchUpdates: Array<Promise<unknown>> = [];

    for (const s of (searches ?? []) as Array<{ id: string; criteria: any; location_ids: string[] | null }>) {
      const current = (s.location_ids ?? []) as string[];
      if (current.length > 0) continue; // já resolvido
      const c = (s.criteria ?? {}) as Record<string, unknown>;
      const candidates = [c.freguesia, c.zona, c.municipio, c.distrito]
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter((v) => v.length > 0);
      const acc = new Set<string>();
      for (const t of candidates) {
        const r = parseLocations(t, snap);
        if (r.resolved.length > 0) {
          for (const id of r.resolved) acc.add(id);
          break;
        }
      }
      if (acc.size > 0) {
        searchesResolved++;
        searchUpdates.push(
          supabaseAdmin
            .from("active_searches")
            .update({ location_ids: [...acc] })
            .eq("id", s.id),
        );
      } else if (candidates.length > 0) {
        searchesUnresolved++;
        unresolvedSearchTexts.push(candidates[0]);
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

async function runChunks(promises: Array<Promise<unknown>>, size: number): Promise<void> {
  for (let i = 0; i < promises.length; i += size) {
    await Promise.all(promises.slice(i, i + size));
  }
}

export type RecomputeAllResult = {
  searches_processed: number;
  opportunities_created: number;
  opportunities_updated: number;
};

export const recomputeAllMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RecomputeAllResult> => {
    await assertAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recomputeForBatch } = await import("./active-searches.functions");

    const nowIso = new Date().toISOString();
    // Reprocessar apenas procuras ativas (não expiradas) de todos os utilizadores.
    const { data: rows, error } = await supabaseAdmin
      .from("active_searches")
      .select("id, user_id")
      .gt("expires_at", nowIso);
    if (error) throw new Error(`Leitura de active_searches falhou: ${error.message}`);

    const byUser = new Map<string, string[]>();
    for (const r of (rows ?? []) as Array<{ id: string; user_id: string }>) {
      const arr = byUser.get(r.user_id) ?? [];
      arr.push(r.id);
      byUser.set(r.user_id, arr);
    }

    let created = 0;
    let updated = 0;
    let processed = 0;
    const CHUNK = 200;
    for (const [uid, ids] of byUser) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const res = await recomputeForBatch(supabaseAdmin as any, uid, slice);
        created += res.created ?? 0;
        updated += res.updated ?? 0;
        processed += slice.length;
      }
    }
    return { searches_processed: processed, opportunities_created: created, opportunities_updated: updated };
  });