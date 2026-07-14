// Geo Parser — função pura, determinística.
//
// Nunca grava. Nunca aprende. Nunca altera dados. Nunca conhece a UI.
// Consome apenas o snapshot devolvido pelo LocationRepository. O mesmo
// input com a mesma versão da biblioteca produz sempre o mesmo output.

import type {
  GeoSnapshot,
  ParseAuditStep,
  ParseResult,
  ParsedSegment,
} from "./geo-types";
import { normalizeGeoText, splitConnectors, toSlug } from "./geo-context";

/**
 * Resolve um segmento textual usando exclusivamente o snapshot passado.
 * Determinístico. Ordem: alias exato → slug → nome exato → freguesia →
 * concelho → distrito → zona funcional (por nome).
 */
function resolveSegment(raw: string, snap: GeoSnapshot, audit: ParseAuditStep[]): ParsedSegment {
  const normalized = normalizeGeoText(raw);
  if (!normalized) {
    return {
      raw,
      normalized,
      location_ids: [],
      matched_via: null,
      confidence: 0,
      unresolved: true,
    };
  }

  // 1) alias exato
  const alias = snap.byAlias.get(normalized);
  if (alias) {
    audit.push({ step: "alias_hit", detail: { raw, alias: alias.alias_normalizado, ids: alias.location_ids } });
    return {
      raw,
      normalized,
      location_ids: [...alias.location_ids],
      matched_via: "alias",
      alias_id: alias.id,
      confidence: 95,
      unresolved: false,
    };
  }

  // 2) slug exato
  const slugKey = toSlug(normalized);
  const bySlug = snap.bySlug.get(normalized) ?? snap.bySlug.get(slugKey);
  if (bySlug) {
    audit.push({ step: "slug_hit", detail: { raw, slug: bySlug.slug, id: bySlug.id } });
    return {
      raw,
      normalized,
      location_ids: [bySlug.id],
      matched_via: "slug",
      confidence: 100,
      unresolved: false,
    };
  }

  // 3) nome exato — por tipo, ordem freguesia → concelho → distrito → zona funcional
  const tipoPriority: Array<ParsedSegment["matched_via"]> = [
    "freguesia",
    "concelho",
    "distrito",
    "zona_funcional",
  ];
  for (const tipo of tipoPriority) {
    for (const l of snap.locations) {
      if (l.tipo !== tipo) continue;
      if (normalizeGeoText(l.nome) === normalized) {
        audit.push({ step: `${tipo}_hit`, detail: { raw, id: l.id } });
        return {
          raw,
          normalized,
          location_ids: [l.id],
          matched_via: tipo,
          confidence: tipo === "freguesia" ? 100 : tipo === "concelho" ? 95 : 90,
          unresolved: false,
        };
      }
    }
  }

  audit.push({ step: "unresolved", detail: { raw } });
  return {
    raw,
    normalized,
    location_ids: [],
    matched_via: null,
    confidence: 0,
    unresolved: true,
  };
}

/**
 * Parser público. Recebe texto livre + snapshot da biblioteca e devolve
 * um `ParseResult` determinístico.
 *
 * Sem fuzzy. Sem side-effects. Sem UI.
 */
export function parseLocations(input: string | null | undefined, snap: GeoSnapshot): ParseResult {
  const audit: ParseAuditStep[] = [];
  const raw = (input ?? "").toString();
  audit.push({ step: "input", detail: { raw, version: snap.version } });

  const segments = splitConnectors(raw);
  audit.push({ step: "split", detail: { segments } });

  const parsed: ParsedSegment[] = segments.map((s) => resolveSegment(s, snap, audit));

  const resolvedSet = new Set<string>();
  const aliasSet = new Set<string>();
  const unresolved: string[] = [];
  for (const p of parsed) {
    for (const id of p.location_ids) resolvedSet.add(id);
    if (p.alias_id) aliasSet.add(p.alias_id);
    if (p.unresolved) unresolved.push(p.raw);
  }

  // Confidence agregada: 0 se algum segmento não resolveu, senão média
  // ponderada arredondada.
  let confidence = 0;
  if (parsed.length > 0) {
    if (unresolved.length > 0) {
      const resolvedSegs = parsed.filter((p) => !p.unresolved);
      const avg = resolvedSegs.length
        ? Math.round(resolvedSegs.reduce((a, p) => a + p.confidence, 0) / resolvedSegs.length)
        : 0;
      // Penaliza fortemente qualquer unresolved.
      confidence = Math.min(avg, 55);
    } else {
      confidence = Math.round(parsed.reduce((a, p) => a + p.confidence, 0) / parsed.length);
    }
  }

  return {
    input: raw,
    resolved: [...resolvedSet],
    aliases_used: [...aliasSet],
    unresolved,
    confidence,
    segments: parsed,
    audit_trail: audit,
    geo_library_version: snap.version,
  };
}