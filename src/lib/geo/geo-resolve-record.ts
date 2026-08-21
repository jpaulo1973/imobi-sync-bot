// Comando 3/3 — Resolutor hierárquico de registo (função pura).
//
// Problema que resolve: os pontos de escrita resolviam cada campo textual de
// forma independente ("primeiro que resolver ganha"), sem contexto de pai e
// sem verificação cruzada. Em Portugal 18 concelhos são homónimos do distrito
// (Setúbal, Porto, Lisboa, Faro, Braga, ...), pelo que um texto de `zona` ou
// uma freguesia homónima podia ancorar o registo no concelho errado — ex.:
// concelho=Grândola, freguesia=Carvalhal a ficar com o ID do concelho Setúbal.
//
// Regras (determinísticas, sem fuzzy, sem I/O):
//  1. distrito e concelho (campos estritos) fixam o CONTEXTO.
//  2. freguesia só aceita candidatos descendentes do contexto; >1 → ambíguo.
//  3. zona (texto livre) só aceita candidatos dentro do contexto; fora do
//     contexto é DESCARTADO (nunca promove o registo para outro concelho).
//  4. O texto de concelho vence sempre: se todos os candidatos mais
//     específicos caírem fora dele, o resultado é o concelho + conflito.

import type { GeoSnapshot, Location, ParseAuditStep } from "./geo-types";
import { normalizeGeoText, toSlug } from "./geo-context";
import { parseLocations } from "./geo-parser";

export type RecordGeoText = {
  distrito?: string | null;
  concelho?: string | null;
  freguesia?: string | null;
  zona?: string | null;
};

export type DiscardedCandidate = {
  field: "distrito" | "freguesia" | "concelho" | "zona";
  raw: string;
  ids: string[];
  reason: "fora_contexto" | "ambiguo";
};

export type RecordGeoResolution = {
  /** ID único mais específico e coerente (para `properties.location_id`). */
  location_id: string | null;
  /** Todos os IDs coerentes (para `active_searches.location_ids`). */
  location_ids: string[];
  level: Location["tipo"] | null;
  distrito_id: string | null;
  concelho_id: string | null;
  /** Texto mais específico contradiz o contexto do concelho. */
  conflict: boolean;
  discarded: DiscardedCandidate[];
  unresolved_text: string | null;
  audit: ParseAuditStep[];
};

const SPECIFICITY: Record<Location["tipo"], number> = {
  freguesia: 4,
  zona_funcional: 3,
  concelho: 2,
  distrito: 1,
};

/** Cadeia de ancestrais (inclui o próprio id). */
export function ancestorChain(id: string, snap: GeoSnapshot): string[] {
  const out: string[] = [id];
  let cur = snap.byId.get(id)?.parent_id ?? null;
  let guard = 0;
  while (cur && guard++ < 20) {
    if (out.includes(cur)) break;
    out.push(cur);
    cur = snap.byId.get(cur)?.parent_id ?? null;
  }
  return out;
}

/** `id` está dentro (ou é) o contexto `contextId`? */
export function isWithin(id: string, contextId: string, snap: GeoSnapshot): boolean {
  if (id === contextId) return true;
  if (ancestorChain(id, snap).includes(contextId)) return true;
  const ctx = snap.byId.get(contextId);
  if (ctx?.tipo === "zona_funcional") {
    return (snap.functionalZoneMembers.get(contextId) ?? []).some(
      (m) => m === id || ancestorChain(id, snap).includes(m),
    );
  }
  const loc = snap.byId.get(id);
  if (loc?.tipo === "zona_funcional") {
    return (snap.functionalZoneMembers.get(id) ?? []).some((m) =>
      ancestorChain(m, snap).includes(contextId),
    );
  }
  return false;
}

/**
 * Enumera TODOS os candidatos de um nível administrativo para um texto — ao
 * contrário do parser, que devolve a primeira ocorrência encontrada (escolha
 * arbitrária entre homónimos).
 */
export function candidatesForLevel(
  text: string,
  snap: GeoSnapshot,
  tipo: Location["tipo"],
): string[] {
  const q = normalizeGeoText(text);
  if (!q) return [];
  const slug = toSlug(q);
  const out: string[] = [];

  const alias = snap.byAlias.get(q);
  if (alias) {
    for (const id of alias.location_ids) {
      if (snap.byId.get(id)?.tipo === tipo && !out.includes(id)) out.push(id);
    }
  }
  for (const l of snap.locations) {
    if (l.tipo !== tipo) continue;
    const nm = normalizeGeoText(l.nome);
    const sl = normalizeGeoText(l.slug);
    if (nm === q || sl === q || sl === slug) {
      if (!out.includes(l.id)) out.push(l.id);
    }
  }
  return out;
}

function pickBest(ids: string[], snap: GeoSnapshot): string | null {
  let best: string | null = null;
  let bestRank = -1;
  for (const id of ids) {
    const tipo = snap.byId.get(id)?.tipo;
    const rank = tipo ? SPECIFICITY[tipo] : 0;
    if (rank > bestRank) {
      best = id;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Resolve a localização de um registo a partir dos seus campos textuais,
 * respeitando a hierarquia. Puro: não grava, não faz I/O, não usa a UI.
 */
export function resolveRecordLocation(
  fields: RecordGeoText,
  snap: GeoSnapshot,
): RecordGeoResolution {
  const audit: ParseAuditStep[] = [];
  const discarded: DiscardedCandidate[] = [];
  const txt = (v: string | null | undefined) => (v ?? "").toString().trim();

  const distritoTxt = txt(fields.distrito);
  const concelhoTxt = txt(fields.concelho);
  const freguesiaTxt = txt(fields.freguesia);
  const zonaTxt = txt(fields.zona);

  audit.push({
    step: "input",
    detail: {
      distrito: distritoTxt || null,
      concelho: concelhoTxt || null,
      freguesia: freguesiaTxt || null,
      zona: zonaTxt || null,
      version: snap.version,
    },
  });

  // ---- 1) Contexto: distrito ----
  let distritoId: string | null = null;
  if (distritoTxt) {
    const cands = candidatesForLevel(distritoTxt, snap, "distrito");
    if (cands.length === 1) {
      distritoId = cands[0]!;
      audit.push({ step: "distrito_ok", detail: { raw: distritoTxt, id: distritoId } });
    } else if (cands.length > 1) {
      discarded.push({ field: "distrito", raw: distritoTxt, ids: cands, reason: "ambiguo" });
    }
  }

  // ---- 2) Contexto: concelho (filtrado pelo distrito) ----
  let concelhoId: string | null = null;
  if (concelhoTxt) {
    let cands = candidatesForLevel(concelhoTxt, snap, "concelho");
    if (distritoId && cands.length > 1) {
      const inCtx = cands.filter((id) => isWithin(id, distritoId!, snap));
      if (inCtx.length > 0) cands = inCtx;
    }
    if (cands.length === 1) {
      concelhoId = cands[0]!;
      audit.push({ step: "concelho_ok", detail: { raw: concelhoTxt, id: concelhoId } });
    } else if (cands.length > 1) {
      discarded.push({ field: "concelho", raw: concelhoTxt, ids: cands, reason: "ambiguo" });
      audit.push({ step: "concelho_ambiguo", detail: { raw: concelhoTxt, ids: cands } });
    }
  }

  const contextId = concelhoId ?? distritoId;
  const coherent: string[] = [];
  let conflict = false;

  // ---- 3) Freguesia dentro do contexto ----
  if (freguesiaTxt) {
    const all = candidatesForLevel(freguesiaTxt, snap, "freguesia");
    const inCtx = contextId ? all.filter((id) => isWithin(id, contextId, snap)) : all;
    if (inCtx.length === 1) {
      coherent.push(inCtx[0]!);
      audit.push({ step: "freguesia_ok", detail: { raw: freguesiaTxt, id: inCtx[0]! } });
    } else if (inCtx.length > 1) {
      discarded.push({ field: "freguesia", raw: freguesiaTxt, ids: inCtx, reason: "ambiguo" });
      audit.push({ step: "freguesia_ambigua", detail: { raw: freguesiaTxt, ids: inCtx } });
    } else if (all.length > 0) {
      // Existe no país mas fora do concelho indicado em texto: descartar.
      discarded.push({ field: "freguesia", raw: freguesiaTxt, ids: all, reason: "fora_contexto" });
      audit.push({ step: "freguesia_fora_contexto", detail: { raw: freguesiaTxt, ids: all } });
      if (concelhoId) conflict = true;
    }
  }

  // ---- 4) Zona (texto livre) restringida ao contexto ----
  if (zonaTxt) {
    const parsed = parseLocations(zonaTxt, snap, { field: "zona" });
    const ids = parsed.resolved;
    const inCtx = contextId ? ids.filter((id) => isWithin(id, contextId, snap)) : ids;
    const out = ids.filter((id) => !inCtx.includes(id));
    for (const id of inCtx) if (!coherent.includes(id)) coherent.push(id);
    if (out.length > 0) {
      discarded.push({ field: "zona", raw: zonaTxt, ids: out, reason: "fora_contexto" });
      audit.push({ step: "zona_fora_contexto", detail: { raw: zonaTxt, ids: out } });
    }
  }

  // ---- 5) Guarda-rail: o concelho em texto vence sempre ----
  if (concelhoId && !coherent.some((id) => isWithin(id, concelhoId!, snap))) {
    coherent.push(concelhoId);
  }
  if (!concelhoId && distritoId && coherent.length === 0) coherent.push(distritoId);

  const location_id = pickBest(coherent, snap);
  const level = location_id ? (snap.byId.get(location_id)?.tipo ?? null) : null;

  const firstText = [freguesiaTxt, concelhoTxt, zonaTxt, distritoTxt].find((t) => t.length > 0) ?? null;

  return {
    location_id,
    location_ids: coherent,
    level,
    distrito_id: distritoId,
    concelho_id: concelhoId,
    conflict,
    discarded,
    unresolved_text: location_id ? null : firstText,
    audit,
  };
}
