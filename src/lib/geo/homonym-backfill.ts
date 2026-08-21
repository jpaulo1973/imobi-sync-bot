// Comando 3/3 — Classificação pura do backfill de homónimos distrito/concelho.
//
// Compara o(s) location_id(s) atuais de um registo com o resultado do
// resolutor hierárquico e decide o que fazer. Sem I/O — testável isoladamente.

import type { GeoSnapshot } from "./geo-types";
import { ancestorChain } from "./geo-resolve-record";
import type { RecordGeoResolution } from "./geo-resolve-record";

export type GeoBackfillClass =
  /** O ID atual contradiz o texto — corrigir. */
  | "corrige"
  /** O texto permite um nível mais fino que o ID atual (ancestral correto). */
  | "especializa"
  /** Nada a fazer. */
  | "mantem"
  /** Texto contraditório: exige revisão humana, nunca grava. */
  | "conflito";

/** Imóvel: um único `location_id`. */
export function classifyProperty(
  currentId: string | null,
  res: RecordGeoResolution,
  snap: GeoSnapshot,
): GeoBackfillClass {
  if (res.conflict) return "conflito";
  const next = res.location_id;
  if (!next) return "mantem";
  if (!currentId) return "corrige";
  if (currentId === next) return "mantem";
  // Atual é ancestral do novo → apenas ganha especificidade.
  if (ancestorChain(next, snap).includes(currentId)) return "especializa";
  return "corrige";
}

/** Procura: conjunto de `location_ids`. */
export function classifySearch(
  currentIds: string[],
  res: RecordGeoResolution,
  snap: GeoSnapshot,
): GeoBackfillClass {
  if (res.conflict) return "conflito";
  const next = res.location_ids;
  if (next.length === 0) return "mantem";
  const cur = [...new Set(currentIds)];
  if (cur.length === 0) return "corrige";
  const sameSet =
    cur.length === next.length && cur.every((id) => next.includes(id));
  if (sameSet) return "mantem";
  // Todos os atuais são ancestrais de algum novo → especialização.
  const allAncestors = cur.every((id) =>
    next.some((n) => n === id || ancestorChain(n, snap).includes(id)),
  );
  if (allAncestors) return "especializa";
  return "corrige";
}
