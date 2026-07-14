// Tipos partilhados da infraestrutura geográfica única do Property Match.
//
// Todas as decisões de localização passam obrigatoriamente pelos tipos
// deste ficheiro. Nenhum consumidor deve inventar tipos paralelos.

export type LocationType =
  | "distrito"
  | "concelho"
  | "freguesia"
  | "zona_funcional";

export type LocationRelationType =
  | "parent"
  | "child"
  | "adjacent"
  | "nearby"
  | "contains";

/** Registo canónico de uma localização na biblioteca. */
export interface Location {
  id: string;
  slug: string;
  nome: string;
  tipo: LocationType;
  parent_id: string | null;
  aprovado: boolean;
}

/** Alias normalizado — pode mapear para uma ou várias localizações. */
export interface LocationAlias {
  id: string;
  alias_normalizado: string;
  location_ids: string[];
  origem: string | null;
  aprovado: boolean;
  times_used: number;
  last_used_at: string | null;
}

/** Resultado por segmento devolvido pelo parser. */
export interface ParsedSegment {
  raw: string;
  normalized: string;
  location_ids: string[];
  matched_via: "slug" | "alias" | "freguesia" | "concelho" | "distrito" | "zona_funcional" | null;
  alias_id?: string | null;
  confidence: number; // 0..100
  unresolved: boolean;
}

/** Passo do audit trail — determinístico, reprodutível. */
export interface ParseAuditStep {
  step: string;
  detail?: Record<string, unknown>;
}

/** Retorno canónico de `parseLocations()`. */
export interface ParseResult {
  input: string;
  resolved: string[]; // location_ids únicos, ordem estável
  aliases_used: string[]; // alias ids
  unresolved: string[]; // segmentos brutos não resolvidos
  confidence: number; // agregado 0..100
  segments: ParsedSegment[];
  audit_trail: ParseAuditStep[];
  geo_library_version: number;
}

/** Regra de aceitação baseada em confidence. */
export type AcceptanceRule =
  | { kind: "auto" }
  | { kind: "auto_audit" }
  | { kind: "suggest_review" }
  | { kind: "manual_review" };

export function classifyConfidence(c: number): AcceptanceRule {
  if (c >= 95) return { kind: "auto" };
  if (c >= 80) return { kind: "auto_audit" };
  if (c >= 60) return { kind: "suggest_review" };
  return { kind: "manual_review" };
}

/** Snapshot devolvido pelo `LocationRepository` para o parser. */
export interface GeoSnapshot {
  version: number;
  locations: Location[];
  aliases: LocationAlias[];
  bySlug: Map<string, Location>;
  byId: Map<string, Location>;
  byAlias: Map<string, LocationAlias>;
  childrenOf: Map<string, string[]>;
  adjacentOf: Map<string, string[]>;
  functionalZoneMembers: Map<string, string[]>;
}