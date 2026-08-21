// B1 — Enriquecimento geográfico a partir do texto original (função pura).
//
// Problema que resolve: as cascatas de ingestão param no primeiro campo
// estruturado que resolve. Quando a micro-zona é desconhecida e só o distrito
// resolve, o registo fica ancorado ao distrito inteiro (ex.: "Vale Flores,
// Almada" → Setúbal[distrito]) e gera falsos positivos no motor.
//
// Regras (determinísticas, sem I/O, sem fuzzy, sem escrita):
//  1. Só actua quando NÃO existe nada mais fino que distrito (nem nos
//     location_ids gravados nem nos campos estruturados). Caso contrário →
//     "mantem": nunca sobrepõe um valor existente.
//  2. Candidatos vêm exclusivamente do texto original, resolvidos pelo parser
//     único, e têm de ser mais finos que distrito.
//  3. Coerência com o distrito gravado é avaliada por ID (logo insensível a
//     acentos e maiúsculas: "Setubal" e "Setúbal" resolvem para o mesmo ID).
//     Texto fora do distrito gravado → "divergencia" (revisão manual).
//  4. Vários candidatos em concelhos diferentes → "divergencia".
//  5. Confiança abaixo do limiar → "baixa_confianca" (nunca preenche às cegas).
//  6. Sem candidatos → "sem_info".

import type { GeoSnapshot, Location, ParseAuditStep } from "./geo-types";
import { splitConnectors } from "./geo-context";
import { parseLocations } from "./geo-parser";
import {
  ancestorChain,
  candidatesForLevel,
  isWithin,
  resolveRecordLocation,
  type RecordGeoText,
} from "./geo-resolve-record";

export const DEFAULT_MIN_CONFIDENCE = 90;

export type GeoEnrichClass =
  | "mantem"
  | "preenche"
  | "divergencia"
  | "baixa_confianca"
  | "sem_info";

export type GeoEnrichCandidate = {
  raw: string;
  id: string;
  nome: string;
  tipo: Location["tipo"];
  confidence: number;
  within_distrito: boolean;
};

export type GeoEnrichResult = {
  classe: GeoEnrichClass;
  /** IDs propostos (vazio quando não há nada a propor). */
  location_ids: string[];
  /** ID único mais específico (para `properties.location_id`). */
  location_id: string | null;
  level: Location["tipo"] | null;
  confidence: number;
  distrito_id: string | null;
  distrito_nome: string | null;
  candidates: GeoEnrichCandidate[];
  motivo: string | null;
  audit: ParseAuditStep[];
};

function nomeOf(id: string, snap: GeoSnapshot): string {
  const l = snap.byId.get(id);
  return l ? `${l.nome} [${l.tipo}]` : id;
}

function concelhoScopeOf(id: string, snap: GeoSnapshot): string {
  for (const anc of ancestorChain(id, snap)) {
    const t = snap.byId.get(anc)?.tipo;
    if (t === "concelho") return anc;
  }
  return id;
}

/** Insensível a acentos/maiúsculas por construção: compara IDs, não strings. */
export function districtIdFromText(
  text: string | null | undefined,
  snap: GeoSnapshot,
): string | null {
  const ids = candidatesForLevel((text ?? "").trim(), snap, "distrito");
  return ids.length === 1 ? ids[0] : null;
}

export type GeoEnrichInput = {
  fields: RecordGeoText;
  /** Texto original da mensagem/registo. */
  texto?: string | null;
  /** location_ids (ou location_id) já gravados no registo. */
  current_ids?: string[] | null;
};

export function enrichRecordGeo(
  input: GeoEnrichInput,
  snap: GeoSnapshot,
  opts?: { minConfidence?: number },
): GeoEnrichResult {
  const minConfidence = opts?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const audit: ParseAuditStep[] = [];
  const current = [...new Set(input.current_ids ?? [])].filter((id) => snap.byId.has(id));
  const structured = resolveRecordLocation(input.fields, snap);

  const finest = (ids: string[]) => ids.filter((id) => snap.byId.get(id)?.tipo !== "distrito");
  const distritoId =
    current.find((id) => snap.byId.get(id)?.tipo === "distrito") ??
    structured.distrito_id ??
    districtIdFromText(input.fields.distrito, snap);
  const distrito_nome = distritoId ? (snap.byId.get(distritoId)?.nome ?? null) : null;

  const base: Omit<GeoEnrichResult, "classe" | "motivo"> = {
    location_ids: [],
    location_id: null,
    level: null,
    confidence: 0,
    distrito_id: distritoId,
    distrito_nome,
    candidates: [],
    audit,
  };

  // 1) Já existe informação mais fina que distrito → nunca tocar.
  const existingFine = [...finest(current), ...finest(structured.location_ids)];
  if (existingFine.length > 0) {
    audit.push({ step: "mantem_existente", detail: { ids: existingFine } });
    return { ...base, classe: "mantem", motivo: null };
  }

  const texto = (input.texto ?? "").toString();
  if (!texto.trim()) {
    audit.push({ step: "sem_texto" });
    return { ...base, classe: "sem_info", motivo: "Sem texto original" };
  }

  // 2) Candidatos do texto livre, segmento a segmento.
  const candidates: GeoEnrichCandidate[] = [];
  for (const seg of splitConnectors(texto)) {
    const r = parseLocations(seg, snap, { field: "livre" });
    for (const s of r.segments) {
      if (s.unresolved) continue;
      for (const id of s.location_ids) {
        const tipo = snap.byId.get(id)?.tipo;
        if (!tipo || tipo === "distrito") continue;
        if (candidates.some((c) => c.id === id)) continue;
        candidates.push({
          raw: s.raw,
          id,
          nome: nomeOf(id, snap),
          tipo,
          confidence: s.confidence,
          within_distrito: distritoId ? isWithin(id, distritoId, snap) : true,
        });
      }
    }
  }
  base.candidates = candidates;
  audit.push({ step: "candidatos_texto", detail: { total: candidates.length } });

  if (candidates.length === 0) {
    return { ...base, classe: "sem_info", motivo: "Texto sem localização reconhecível" };
  }

  const within = candidates.filter((c) => c.within_distrito);
  if (within.length === 0) {
    return {
      ...base,
      classe: "divergencia",
      motivo: `Texto sugere ${candidates.map((c) => c.nome).join(", ")} fora do distrito gravado (${distrito_nome ?? "—"})`,
    };
  }

  // 3) Ramos distintos dentro do distrito → ambíguo, revisão manual.
  const scopes = [...new Set(within.map((c) => concelhoScopeOf(c.id, snap)))];
  if (scopes.length > 1) {
    return {
      ...base,
      classe: "divergencia",
      motivo: `Vários candidatos em concelhos diferentes: ${scopes.map((s) => nomeOf(s, snap)).join(", ")}`,
    };
  }

  // 4) Folhas: descarta candidatos que são ancestrais de outro candidato.
  const leaves = within.filter(
    (c) => !within.some((o) => o.id !== c.id && ancestorChain(o.id, snap).includes(c.id)),
  );
  const chosen = leaves.length > 0 ? leaves : within;
  const confidence = Math.min(...chosen.map((c) => c.confidence));
  const location_ids = chosen.map((c) => c.id);
  const location_id = chosen[0].id;
  const level = snap.byId.get(location_id)?.tipo ?? null;

  if (confidence < minConfidence) {
    return {
      ...base,
      candidates,
      confidence,
      classe: "baixa_confianca",
      motivo: `Confiança ${confidence} < ${minConfidence} (${chosen.map((c) => c.nome).join(", ")})`,
    };
  }

  audit.push({ step: "preenche", detail: { ids: location_ids, confidence } });
  return {
    ...base,
    classe: "preenche",
    location_ids,
    location_id,
    level,
    confidence,
    candidates,
    motivo: null,
  };
}
