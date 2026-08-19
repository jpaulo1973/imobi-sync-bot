// Geo Parser — função pura, determinística.
//
// Nunca grava. Nunca aprende. Nunca altera dados. Nunca conhece a UI.
// Consome apenas o snapshot devolvido pelo LocationRepository. O mesmo
// input com a mesma versão da biblioteca produz sempre o mesmo output.

import type {
  GeoSnapshot,
  GeoFieldOrigin,
  ParseAuditStep,
  ParseResult,
  ParsedSegment,
} from "./geo-types";
import { normalizeGeoText, splitConnectors, toSlug } from "./geo-context";

/** Cadeia de ancestrais (inclui o próprio id). */
function ancestorsOf(id: string, snap: GeoSnapshot): Set<string> {
  const out = new Set<string>([id]);
  let cur = snap.byId.get(id)?.parent_id ?? null;
  let guard = 0;
  while (cur && guard++ < 20) {
    if (out.has(cur)) break;
    out.add(cur);
    cur = snap.byId.get(cur)?.parent_id ?? null;
  }
  return out;
}

/**
 * Verdadeiro quando todos os ids pertencem à mesma hierarquia: existe um id
 * que é ancestral (ou o próprio) de todos os outros, ou todos são membros da
 * mesma zona funcional. Caso contrário o conjunto é ambíguo (ex.: "Miragaia"
 * → freguesia da Lourinhã e freguesia do Porto).
 */
function isSameHierarchy(ids: string[], snap: GeoSnapshot): boolean {
  if (ids.length <= 1) return true;
  for (const candidate of ids) {
    if (ids.every((other) => ancestorsOf(other, snap).has(candidate))) return true;
  }
  // Zona funcional explícita entre os ids.
  for (const id of ids) {
    if (snap.byId.get(id)?.tipo === "zona_funcional") {
      const members = new Set(snap.functionalZoneMembers.get(id) ?? []);
      if (ids.every((other) => other === id || members.has(other))) return true;
    }
  }
  // Todos membros de uma mesma zona funcional.
  for (const members of snap.functionalZoneMembers.values()) {
    const set = new Set(members);
    if (ids.every((id) => set.has(id))) return true;
  }
  return false;
}

/**
 * Resolve um segmento textual usando exclusivamente o snapshot passado.
 * Determinístico. Quando `field` identifica o campo de origem do texto
 * (distrito / concelho / freguesia), a resolução é restringida a esse
 * nível administrativo — nunca cai para outro nível (sem fallback
 * silencioso). Para texto livre (`zona` / `livre`) mantém-se a ordem
 * alias → slug → freguesia → concelho → distrito → zona funcional.
 */
function resolveSegment(
  raw: string,
  snap: GeoSnapshot,
  audit: ParseAuditStep[],
  field: GeoFieldOrigin,
): ParsedSegment {
  const normalized = normalizeGeoText(raw);
  const strictTipo =
    field === "distrito" || field === "concelho" || field === "freguesia" ? field : null;
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

  // 1) alias exato — só aceitável se todos os ids respeitarem o nível pedido.
  const alias = snap.byAlias.get(normalized);
  if (alias && (!strictTipo || alias.location_ids.every((id) => snap.byId.get(id)?.tipo === strictTipo))) {
    // Alias ambíguo: várias localizações sem relação hierárquica. Nunca
    // escolher silenciosamente — o segmento vai para revisão manual com o
    // texto original preservado.
    if (!isSameHierarchy(alias.location_ids, snap)) {
      audit.push({
        step: "alias_ambiguous",
        detail: { raw, alias: alias.alias_normalizado, ids: alias.location_ids },
      });
      return {
        raw,
        normalized,
        location_ids: [],
        matched_via: null,
        alias_id: alias.id,
        confidence: 0,
        unresolved: true,
        ambiguous_ids: [...alias.location_ids],
      };
    }
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
  if (bySlug && (!strictTipo || bySlug.tipo === strictTipo)) {
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
  const tipoPriority: Array<ParsedSegment["matched_via"]> = strictTipo
    ? [strictTipo]
    : ["freguesia", "concelho", "distrito", "zona_funcional"];
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

  audit.push({ step: "unresolved", detail: { raw, field } });
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
export function parseLocations(
  input: string | null | undefined,
  snap: GeoSnapshot,
  opts?: { field?: GeoFieldOrigin },
): ParseResult {
  const field: GeoFieldOrigin = opts?.field ?? "livre";
  const audit: ParseAuditStep[] = [];
  const raw = (input ?? "").toString();
  audit.push({ step: "input", detail: { raw, version: snap.version, field } });

  const segments = splitConnectors(raw);
  audit.push({ step: "split", detail: { segments } });

  const parsed: ParsedSegment[] = segments.map((s) => resolveSegment(s, snap, audit, field));

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