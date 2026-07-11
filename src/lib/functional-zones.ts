// Release 1.2 — Motor Geo Funcional.
//
// Este módulo é PURO (sem createServerFn no ficheiro — respeita
// tss-serverfn-split). Server fns importam `resolveZone` e passam um
// resolver context para o matching engine.

import { areFreguesiasAdjacent, isKnownConcelho, isKnownFreguesia, normalizeLocation } from "./location-graph";

export type ZoneCoverage = {
  freguesias: string[];
  municipios: string[];
};

export type ResolvedZone = {
  freguesias: string[]; // normalizadas
  municipios: string[]; // normalizadas
  source: "admin" | "functional" | "unknown";
  unknown: boolean;
  matchedZone?: { id: string; nome: string } | null;
};

export type FunctionalZoneRow = {
  id: string;
  nome: string;
  aliases: string[] | null;
  coverage: ZoneCoverage | null;
  approved: boolean;
};

/**
 * Contexto passado ao motor para evitar re-carregar/re-resolver a cada
 * chamada durante o mesmo request.
 */
export type ZoneResolverContext = {
  zones: FunctionalZoneRow[];
  cache: Map<string, ResolvedZone>;
};

export function createZoneContext(zones: FunctionalZoneRow[]): ZoneResolverContext {
  return { zones: zones.filter((z) => z.approved !== false), cache: new Map() };
}

/**
 * Carrega TODAS as functional_zones via admin (leitura barata, tabela
 * pequena) e devolve um contexto pronto a ser passado ao motor.
 */
export async function loadZoneContext(): Promise<ZoneResolverContext> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("functional_zones")
      .select("id, nome, aliases, coverage, approved")
      .eq("approved", true);
    return createZoneContext((data ?? []) as FunctionalZoneRow[]);
  } catch (e) {
    console.error("loadZoneContext failed", e);
    return createZoneContext([]);
  }
}

/**
 * Resolve uma string de localização.
 *  1) Match administrativo (concelho conhecido / freguesia com adjacências)
 *  2) Match em zonas funcionais (nome ou aliases)
 *  3) unknown = true → o caller deve marcar flagged_for_review com motivo
 *     "zona_desconhecida".
 */
export function resolveZone(input: string | null | undefined, ctx?: ZoneResolverContext): ResolvedZone {
  const key = normalizeLocation(input);
  if (!key) return { freguesias: [], municipios: [], source: "unknown", unknown: true };
  if (ctx?.cache.has(key)) return ctx.cache.get(key)!;

  // 1) Administrativo — concelho conhecido cobre todas as freguesias do concelho.
  if (isKnownConcelho(key)) {
    const r: ResolvedZone = {
      freguesias: [],
      municipios: [key],
      source: "admin",
      unknown: false,
    };
    ctx?.cache.set(key, r);
    return r;
  }

  // 2) Zonas funcionais (nome ou aliases).
  if (ctx) {
    for (const z of ctx.zones) {
      const nomeMatch = normalizeLocation(z.nome) === key;
      const aliasMatch = (z.aliases ?? []).some((a) => normalizeLocation(a) === key);
      if (nomeMatch || aliasMatch) {
        const cov = z.coverage ?? { freguesias: [], municipios: [] };
        const r: ResolvedZone = {
          freguesias: (cov.freguesias ?? []).map(normalizeLocation).filter(Boolean),
          municipios: (cov.municipios ?? []).map(normalizeLocation).filter(Boolean),
          source: "functional",
          unknown: false,
          matchedZone: { id: z.id, nome: z.nome },
        };
        ctx.cache.set(key, r);
        return r;
      }
    }
  }

  // 3) Freguesia administrativa reconhecida no grafo de adjacências.
  if (isKnownFreguesia(key)) {
    const r: ResolvedZone = {
      freguesias: [key],
      municipios: [],
      source: "admin",
      unknown: false,
    };
    ctx?.cache.set(key, r);
    return r;
  }

  // 4) Expressão desconhecida — sinaliza revisão.
  const r: ResolvedZone = {
    freguesias: [],
    municipios: [],
    source: "unknown",
    unknown: true,
  };
  ctx?.cache.set(key, r);
  return r;
}

// Reutilizado por callers que queiram testar adjacência a partir do
// resultado resolvido (mantém compatibilidade com location-graph).
export { areFreguesiasAdjacent, normalizeLocation };

/**
 * Verifica se um imóvel (freguesia/concelho/zona) está dentro da cobertura
 * devolvida por resolveZone. Usado pelo motor quando o bZone administrativo
 * padrão não casou e o buyer indicou uma zona funcional.
 */
export function coverageIncludesProperty(
  resolved: ResolvedZone,
  property: { freguesia?: string | null; concelho?: string | null; zona?: string | null },
): boolean {
  if (resolved.unknown) return false;
  const pFreg = normalizeLocation(property.freguesia);
  const pConc = normalizeLocation(property.concelho);
  const pZona = normalizeLocation(property.zona);
  const fSet = new Set(resolved.freguesias);
  const mSet = new Set(resolved.municipios);
  if (pFreg && fSet.has(pFreg)) return true;
  if (pConc && mSet.has(pConc)) return true;
  if (pZona && (fSet.has(pZona) || mSet.has(pZona))) return true;
  return false;
}