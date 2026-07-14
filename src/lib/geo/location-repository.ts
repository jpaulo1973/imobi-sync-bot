// LocationRepository — única API de acesso à infraestrutura geográfica.
//
// Nenhum outro componente (parser, motor, UI, server functions, importadores)
// pode consultar diretamente as tabelas geográficas. Toda a leitura passa
// obrigatoriamente por aqui, para garantir uma única fonte de verdade e
// permitir cache/coerência de versão.

import type {
  GeoSnapshot,
  Location,
  LocationAlias,
  LocationType,
} from "./geo-types";
import { normalizeGeoText, toSlug } from "./geo-context";

let snapshotCache: {
  snapshot: GeoSnapshot;
  loadedAt: number;
} | null = null;

const CACHE_TTL_MS = 60_000;

function indexSnapshot(
  version: number,
  locations: Location[],
  aliases: LocationAlias[],
  relations: Array<{ from_location_id: string; to_location_id: string; relation_type: string }>,
  functionalMembers: Array<{ functional_zone_id: string; location_id: string }>,
): GeoSnapshot {
  const bySlug = new Map<string, Location>();
  const byId = new Map<string, Location>();
  for (const l of locations) {
    byId.set(l.id, l);
    bySlug.set(normalizeGeoText(l.slug), l);
  }
  const byAlias = new Map<string, LocationAlias>();
  for (const a of aliases) {
    if (!a.aprovado) continue;
    byAlias.set(normalizeGeoText(a.alias_normalizado), a);
  }
  const childrenOf = new Map<string, string[]>();
  const adjacentOf = new Map<string, string[]>();
  for (const r of relations) {
    if (r.relation_type === "child" || r.relation_type === "contains") {
      const arr = childrenOf.get(r.from_location_id) ?? [];
      arr.push(r.to_location_id);
      childrenOf.set(r.from_location_id, arr);
    }
    if (r.relation_type === "adjacent" || r.relation_type === "nearby") {
      const a = adjacentOf.get(r.from_location_id) ?? [];
      a.push(r.to_location_id);
      adjacentOf.set(r.from_location_id, a);
      const b = adjacentOf.get(r.to_location_id) ?? [];
      b.push(r.from_location_id);
      adjacentOf.set(r.to_location_id, b);
    }
  }
  // Também derivar children a partir de parent_id (fallback).
  for (const l of locations) {
    if (l.parent_id) {
      const arr = childrenOf.get(l.parent_id) ?? [];
      if (!arr.includes(l.id)) arr.push(l.id);
      childrenOf.set(l.parent_id, arr);
    }
  }
  const functionalZoneMembers = new Map<string, string[]>();
  for (const m of functionalMembers) {
    const arr = functionalZoneMembers.get(m.functional_zone_id) ?? [];
    arr.push(m.location_id);
    functionalZoneMembers.set(m.functional_zone_id, arr);
  }
  return {
    version,
    locations,
    aliases,
    bySlug,
    byId,
    byAlias,
    childrenOf,
    adjacentOf,
    functionalZoneMembers,
  };
}

/**
 * Carrega o snapshot completo da biblioteca a partir do storage.
 * Server-only — chama `supabaseAdmin` (leitura de tabelas de referência).
 */
async function loadSnapshot(): Promise<GeoSnapshot> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [versionRes, locationsRes, aliasesRes, relationsRes, membersRes] = await Promise.all([
    supabaseAdmin.from("geo_library_version").select("version").order("version", { ascending: false }).limit(1),
    supabaseAdmin.from("locations").select("id, slug, nome, tipo, parent_id, aprovado").eq("aprovado", true),
    supabaseAdmin.from("location_aliases").select("id, alias_normalizado, location_ids, origem, aprovado, times_used, last_used_at"),
    supabaseAdmin.from("location_relations").select("from_location_id, to_location_id, relation_type"),
    supabaseAdmin.from("functional_zone_members").select("functional_zone_id, location_id"),
  ]);
  const version = Number(versionRes.data?.[0]?.version ?? 1);
  const locations = (locationsRes.data ?? []) as unknown as Location[];
  const aliases = (aliasesRes.data ?? []) as unknown as LocationAlias[];
  return indexSnapshot(
    version,
    locations,
    aliases,
    (relationsRes.data ?? []) as Array<{ from_location_id: string; to_location_id: string; relation_type: string }>,
    (membersRes.data ?? []) as Array<{ functional_zone_id: string; location_id: string }>,
  );
}

export const LocationRepository = {
  /** Devolve o snapshot atual (com cache TTL). */
  async getSnapshot(force = false): Promise<GeoSnapshot> {
    const now = Date.now();
    if (!force && snapshotCache && now - snapshotCache.loadedAt < CACHE_TTL_MS) {
      return snapshotCache.snapshot;
    }
    const snap = await loadSnapshot();
    snapshotCache = { snapshot: snap, loadedAt: now };
    return snap;
  },

  /** Invalidação explícita — chamar após promoteAlias / seed / mutações. */
  invalidate(): void {
    snapshotCache = null;
  },

  async getById(id: string): Promise<Location | null> {
    const snap = await this.getSnapshot();
    return snap.byId.get(id) ?? null;
  },

  async getBySlug(slug: string): Promise<Location | null> {
    const snap = await this.getSnapshot();
    return snap.bySlug.get(normalizeGeoText(slug)) ?? null;
  },

  async search(text: string, opts?: { tipo?: LocationType; limit?: number }): Promise<Location[]> {
    const snap = await this.getSnapshot();
    const q = normalizeGeoText(text);
    if (!q) return [];
    const limit = opts?.limit ?? 20;
    const out: Location[] = [];
    for (const l of snap.locations) {
      if (opts?.tipo && l.tipo !== opts.tipo) continue;
      const nm = normalizeGeoText(l.nome);
      const sl = normalizeGeoText(l.slug);
      if (nm === q || sl === q || nm.startsWith(q) || sl.startsWith(q) || nm.includes(q)) {
        out.push(l);
        if (out.length >= limit) break;
      }
    }
    return out;
  },

  /**
   * Resolve um único segmento textual em IDs. Determinístico, sem fuzzy.
   * Ordem de resolução: alias exato → slug → nome normalizado.
   */
  async resolve(text: string): Promise<{ ids: string[]; matched_via: "alias" | "slug" | "nome" | null; alias_id?: string | null }> {
    const snap = await this.getSnapshot();
    const q = normalizeGeoText(text);
    if (!q) return { ids: [], matched_via: null };
    const alias = snap.byAlias.get(q);
    if (alias) return { ids: [...alias.location_ids], matched_via: "alias", alias_id: alias.id };
    const bySlug = snap.bySlug.get(q) ?? snap.bySlug.get(toSlug(q));
    if (bySlug) return { ids: [bySlug.id], matched_via: "slug" };
    for (const l of snap.locations) {
      if (normalizeGeoText(l.nome) === q) return { ids: [l.id], matched_via: "nome" };
    }
    return { ids: [], matched_via: null };
  },

  async getChildren(id: string): Promise<string[]> {
    const snap = await this.getSnapshot();
    return [...(snap.childrenOf.get(id) ?? [])];
  },

  async getAdjacent(id: string): Promise<string[]> {
    const snap = await this.getSnapshot();
    return [...(snap.adjacentOf.get(id) ?? [])];
  },

  async getFunctionalZoneMembers(id: string): Promise<string[]> {
    const snap = await this.getSnapshot();
    return [...(snap.functionalZoneMembers.get(id) ?? [])];
  },

  /** Cobertura recursiva — inclui o próprio id, descendentes e adjacentes diretos. */
  async getCoverage(id: string): Promise<string[]> {
    const snap = await this.getSnapshot();
    const seen = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of snap.childrenOf.get(cur) ?? []) {
        if (!seen.has(c)) {
          seen.add(c);
          stack.push(c);
        }
      }
      // Zonas funcionais: expandir os membros.
      const loc = snap.byId.get(cur);
      if (loc?.tipo === "zona_funcional") {
        for (const m of snap.functionalZoneMembers.get(cur) ?? []) {
          if (!seen.has(m)) {
            seen.add(m);
            stack.push(m);
          }
        }
      }
    }
    return [...seen];
  },
};

export type LocationRepositoryType = typeof LocationRepository;