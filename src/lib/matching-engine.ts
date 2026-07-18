// Motor de compatibilidade Property Match — Release 1.3 (Fase 3).
//
// Arquitectura: registo configurável de Hard Filters. Cada filtro devolve
// {ok:true} | {ok:false, reason} | {ok:false, needsReview, reviewReason, reason}.
// Um único filtro falhado impede totalmente a geração da oportunidade.
// Só depois de TODOS passarem é calculado o soft score (0-100).
//
// Fase 3 — o motor deixou de interpretar texto de localização. Toda a
// resolução geográfica passa exclusivamente por `location_id` / `location_ids`
// e pelo `GeoMatchIndex` derivado do `LocationRepository`.

import type { GeoSnapshot } from "@/lib/geo";

// ---------------------------------------------------------------------------
// GeoMatchIndex — projecção síncrona do GeoSnapshot para o motor puro.
//
// Cobre as quatro operações estruturais suportadas pela infraestrutura
// geográfica (parent, child, adjacent, functionalMembers). Não depende de
// qualquer estrutura textual legada (aliases textuais, grafos hard-coded).
// ---------------------------------------------------------------------------

export type GeoMatchIndex = {
  parentsOf: (id: string) => string[];
  childrenOf: (id: string) => string[];
  adjacentOf: (id: string) => string[];
  functionalMembersOf: (id: string) => string[];
  /** Nome legível da localização (para auditoria). */
  nameOf: (id: string) => string | null;
};

export function buildGeoMatchIndex(snap: GeoSnapshot): GeoMatchIndex {
  const parentsCache = new Map<string, string[]>();
  const descendantsCache = new Map<string, string[]>();
  const functionalCache = new Map<string, string[]>();

  const collectAncestors = (id: string): string[] => {
    const cached = parentsCache.get(id);
    if (cached) return cached;
    const out: string[] = [];
    let cur = snap.byId.get(id) ?? null;
    const guard = new Set<string>([id]);
    while (cur?.parent_id && !guard.has(cur.parent_id)) {
      out.push(cur.parent_id);
      guard.add(cur.parent_id);
      cur = snap.byId.get(cur.parent_id) ?? null;
    }
    parentsCache.set(id, out);
    return out;
  };

  const collectDescendants = (id: string): string[] => {
    const cached = descendantsCache.get(id);
    if (cached) return cached;
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of snap.childrenOf.get(cur) ?? []) {
        if (!seen.has(child)) {
          seen.add(child);
          stack.push(child);
        }
      }
    }
    const out = [...seen];
    descendantsCache.set(id, out);
    return out;
  };

  const collectFunctionalMembers = (id: string): string[] => {
    const cached = functionalCache.get(id);
    if (cached) return cached;
    const loc = snap.byId.get(id);
    if (!loc || loc.tipo !== "zona_funcional") {
      functionalCache.set(id, []);
      return [];
    }
    const seen = new Set<string>();
    const stack = [...(snap.functionalZoneMembers.get(id) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const child of snap.childrenOf.get(cur) ?? []) {
        if (!seen.has(child)) stack.push(child);
      }
    }
    const out = [...seen];
    functionalCache.set(id, out);
    return out;
  };

  return {
    parentsOf: collectAncestors,
    childrenOf: collectDescendants,
    adjacentOf: (id) => [...(snap.adjacentOf.get(id) ?? [])],
    functionalMembersOf: collectFunctionalMembers,
    nameOf: (id) => snap.byId.get(id)?.nome ?? null,
  };
}

function normTipoText(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim().toLowerCase();
}

export type BuyerLike = {
  finalidade?: string | null;
  tipo_imovel?: string[] | null;
  tipologia?: string | null;
  /** IDs de localização pretendidos (Fase 3 — única fonte geográfica). */
  location_ids?: string[] | null;
  budget_min?: number | string | null;
  budget_max?: number | string | null;
  area_min?: number | string | null;
  quartos_min?: number | null;
  garagem_obrigatoria?: boolean | null;
  elevador_obrigatorio?: boolean | null;
  proximity?: unknown | null;
  // Sinais textuais que ajudam a caracterizar a intenção da procura
  // (ex.: "investidor", "empreendimento com >80 frações", "retail park").
  // Populados a partir do resumo/caracteristicas/texto original.
  caracteristicas?: string[] | null;
  resumo?: string | null;
  texto_original?: string | null;
};

export type PropertyLike = {
  finalidade?: string | null;
  tipo_imovel?: string | null;
  tipologia?: string | null;
  /** ID da localização do imóvel (Fase 3 — única fonte geográfica). */
  location_id?: string | null;
  preco?: number | string | null;
  area_util_m2?: number | string | null;
  area_m2?: number | string | null;
  area_terreno_m2?: number | string | null;
  quartos?: number | null;
  garagem?: boolean | null;
  elevador?: boolean | null;
  jardim?: boolean | null;
  piscina?: boolean | null;
};

export type MatchCategoryKey =
  | "finalidade"
  | "tipo"
  | "tipologia"
  | "preco"
  | "localizacao"
  | "area"
  | "extras";

export type MatchCategoryResult = {
  key: MatchCategoryKey;
  label: string;
  ok: boolean;
  detail: string;
  score: number;
  weight: number;
};

export type ReviewReason =
  | "freguesia_em_falta"
  | "area_em_falta";

export type NeedsReview = { reviewReason: ReviewReason; reason: string };

// Release 1.2 — Auditoria do Motor Match.
// Cada rejeição de comprador↔imóvel devolve um `rejectReason` estruturado
// que alimenta o breakdown "0 compatíveis de N analisados: X localização…".
export type RejectReason =
  | "FINALIDADE"
  | "TIPO_IMOVEL"
  | "INVESTIDOR_BULK"
  | "LOCALIZACAO"
  | "AREA"
  | "CARACTERISTICAS"
  | "ORCAMENTO"
  | "TIPOLOGIA";

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  FINALIDADE: "finalidade",
  TIPO_IMOVEL: "tipo de imóvel",
  INVESTIDOR_BULK: "investidor/bulk",
  LOCALIZACAO: "localização",
  AREA: "área",
  CARACTERISTICAS: "características",
  ORCAMENTO: "orçamento",
  TIPOLOGIA: "tipologia",
};

export type MatchScore = {
  score: number; // 0-100
  compatible: boolean;
  needsReview: NeedsReview | null;
  categories: MatchCategoryResult[];
  reasons: string[];
  /** Presente sempre que `compatible === false`. */
  rejectReason: RejectReason | null;
};

export type MatchOptions = {
  /**
   * Tolerância adicional ao orçamento máximo (0-1). Por defeito 0.10
   * (regra de negócio do Property Match — margem inteligente de 10%).
   */
  priceTolerance?: number;
  /**
   * Índice geográfico pré-calculado a partir do LocationRepository.
   * Requerido para resolver hierarquia (parent/child), adjacência e zonas
   * funcionais. Sem `geoIndex` o motor só reconhece match directo por ID.
   */
  geoIndex?: GeoMatchIndex | null;
};

// Pesos soft (somam 100). Só se aplicam a imóveis que passaram nos Hard Filters.
const WEIGHTS: Record<"localizacao" | "tipologia" | "preco" | "area" | "extras", number> = {
  localizacao: 40,
  tipologia: 25,
  preco: 15,
  area: 12,
  extras: 8,
};

export const COMPAT_THRESHOLD = 0; // Elegibilidade é decidida pelos Hard Filters.

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Defesa: só aceita T0..T20. Valores implausíveis (ex.: "T73" gravado por um
// bug antigo do importador) são tratados como null — nunca 73 quartos.
// A fonte de verdade da normalização vive em src/lib/bedrooms-normalize.ts;
// aqui replicamos apenas o clamp para não criar dependência circular no motor
// puro. Se o limite mudar, atualizar MAX_PLAUSIBLE_BEDROOMS lá.
const MATCHING_MAX_BEDROOMS = 20;
function tipologiaQuartos(t: string | null | undefined): number | null {
  const m = /^t\s*(\d{1,3})/i.exec((t ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0 || n > MATCHING_MAX_BEDROOMS) {
    if (n > MATCHING_MAX_BEDROOMS) {
      console.warn(`[matching-engine] tipologia implausível ignorada: ${JSON.stringify(t)}`);
    }
    return null;
  }
  return n;
}
function sanitizeQuartos(v: number | null | undefined, source: string): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  if (v > MATCHING_MAX_BEDROOMS) {
    console.warn(`[matching-engine] ${source} implausível ignorado: ${v}`);
    return null;
  }
  return v;
}

function fail(
  key: MatchCategoryKey,
  label: string,
  detail: string,
  rejectReason: RejectReason,
  needsReview: NeedsReview | null = null,
): MatchScore {
  return {
    score: 0,
    compatible: false,
    needsReview,
    categories: [{ key, label, ok: false, detail, score: 0, weight: 0 }],
    reasons: [],
    rejectReason,
  };
}

// ---------- Hard Filters (configurable registry) ----------

export type HardFilterOk = { ok: true; category: MatchCategoryResult };
export type HardFilterFail = {
  ok: false;
  category: MatchCategoryResult;
  needsReview?: NeedsReview;
  rejectReason: RejectReason;
};
export type HardFilterResult = HardFilterOk | HardFilterFail;

export type HardFilter = {
  name: string;
  key: MatchCategoryKey;
  run: (buyer: BuyerLike, property: PropertyLike, ctx?: GeoMatchIndex | null) => HardFilterResult;
};

function finalidadeFilter(buyer: BuyerLike, property: PropertyLike): HardFilterResult {
  const b = (buyer.finalidade ?? "").toString().toLowerCase();
  const p = (property.finalidade ?? "").toString().toLowerCase();
  if (!b || b === "indefinido") {
    return { ok: false, rejectReason: "FINALIDADE", category: cat("finalidade", "Finalidade", false, "Finalidade da procura não indicada") };
  }
  if (!p) {
    return { ok: false, rejectReason: "FINALIDADE", category: cat("finalidade", "Finalidade", false, "Finalidade do imóvel não indicada") };
  }
  const buyerAcceptsBoth = b === "ambos" || b === "venda_arrendamento";
  if (!buyerAcceptsBoth && b !== p) {
    return { ok: false, rejectReason: "FINALIDADE", category: cat("finalidade", "Finalidade", false, `Finalidade incompatível (procura ${b}, imóvel ${p})`) };
  }
  return { ok: true, category: cat("finalidade", "Finalidade", true, property.finalidade ?? "—") };
}

function tipoFilter(buyer: BuyerLike, property: PropertyLike): HardFilterResult {
  const buyerTipos = (buyer.tipo_imovel ?? []).map(normTipoText).filter(Boolean);
  const pTipo = normTipoText(property.tipo_imovel);
  const pTipoRaw = pTipo;
  const isTerrainType =
    pTipoRaw === "terreno" || pTipoRaw === "quinta" || pTipoRaw === "herdade";
  if (buyerTipos.length === 0) {
    // Correções 1.3: para imóveis Quinta/Terreno/Herdade, procuras sem tipo
    // declarado NÃO devem ser eliminadas neste filtro — a intenção do
    // consultor fica caracterizada pelos restantes filtros (localização,
    // área mínima, orçamento). A tipologia deixa de mandar; o tipo também
    // não deve mandar quando o imóvel é rústico e o comprador não o
    // desqualificou explicitamente.
    if (isTerrainType) {
      return { ok: true, category: cat("tipo", "Tipo", true, property.tipo_imovel ?? "—") };
    }
    return { ok: false, rejectReason: "TIPO_IMOVEL", category: cat("tipo", "Tipo", false, "Tipo de imóvel não indicado na procura") };
  }
  if (!pTipo) {
    return { ok: false, rejectReason: "TIPO_IMOVEL", category: cat("tipo", "Tipo", false, "Tipo do imóvel não declarado") };
  }
  if (!buyerTipos.includes(pTipo)) {
    return { ok: false, rejectReason: "TIPO_IMOVEL", category: cat("tipo", "Tipo", false, `Tipo ${property.tipo_imovel} fora do pedido`) };
  }
  return { ok: true, category: cat("tipo", "Tipo", true, property.tipo_imovel!) };
}

function cat(key: MatchCategoryKey, label: string, ok: boolean, detail: string, score = 0, weight = 0): MatchCategoryResult {
  return { key, label, ok, detail, score, weight };
}

function localizacaoFilter(
  buyer: BuyerLike,
  property: PropertyLike,
  geoIndex?: GeoMatchIndex | null,
): HardFilterResult {
  const weight = WEIGHTS.localizacao;
  const buyerIds = (buyer.location_ids ?? []).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (buyerIds.length === 0) {
    return {
      ok: false,
      rejectReason: "LOCALIZACAO",
      category: cat("localizacao", "Localização", false, "Localização não indicada na procura"),
    };
  }
  const propertyId =
    typeof property.location_id === "string" && property.location_id
      ? property.location_id
      : null;
  if (!propertyId) {
    return {
      ok: false,
      rejectReason: "LOCALIZACAO",
      needsReview: {
        reviewReason: "freguesia_em_falta",
        reason: "Localização do imóvel em falta",
      },
      category: cat(
        "localizacao",
        "Localização",
        false,
        "Imóvel sem localização estruturada — revisão manual",
      ),
    };
  }

  const buyerSet = new Set(buyerIds);

  // 1) Match directo — intersecção entre location_ids do comprador e o
  //    location_id do imóvel.
  if (buyerSet.has(propertyId)) {
    return {
      ok: true,
      category: cat("localizacao", "Localização", true, "Localização pretendida", weight, weight),
    };
  }

  if (!geoIndex) {
    return {
      ok: false,
      rejectReason: "LOCALIZACAO",
      category: cat("localizacao", "Localização", false, "Localização fora da área pretendida"),
    };
  }

  const propertyAncestors = geoIndex.parentsOf(propertyId);

  // 2) Relação hierárquica ascendente — buyer pediu concelho/distrito e
  //    imóvel está numa freguesia descendente.
  for (const ancestor of propertyAncestors) {
    if (buyerSet.has(ancestor)) {
      return {
        ok: true,
        category: cat(
          "localizacao",
          "Localização",
          true,
          "Dentro da área administrativa pretendida",
          weight,
          weight,
        ),
      };
    }
  }

  // 3) Relação hierárquica descendente — buyer pediu freguesia e imóvel está
  //    no concelho pai (ou nível superior).
  for (const buyerId of buyerIds) {
    const descendants = geoIndex.childrenOf(buyerId);
    if (descendants.includes(propertyId)) {
      return {
        ok: true,
        category: cat(
          "localizacao",
          "Localização",
          true,
          "Dentro do perímetro alargado da procura",
          weight,
          weight,
        ),
      };
    }
  }

  // 4) Zona funcional — buyer pediu uma zona_funcional cujos membros
  //    (recursivos, incluindo descendentes desses membros) incluem o imóvel.
  for (const buyerId of buyerIds) {
    const members = geoIndex.functionalMembersOf(buyerId);
    if (members.length === 0) continue;
    if (members.includes(propertyId)) {
      return {
        ok: true,
        category: cat(
          "localizacao",
          "Localização",
          true,
          "Zona funcional pretendida",
          Math.round(weight * 0.8),
          weight,
        ),
      };
    }
    for (const ancestor of propertyAncestors) {
      if (members.includes(ancestor)) {
        return {
          ok: true,
          category: cat(
            "localizacao",
            "Localização",
            true,
            "Zona funcional pretendida",
            Math.round(weight * 0.8),
            weight,
          ),
        };
      }
    }
  }

  // 5) Adjacência — algum ID pretendido pelo buyer é adjacente ao imóvel.
  for (const buyerId of buyerIds) {
    if (geoIndex.adjacentOf(buyerId).includes(propertyId)) {
      return {
        ok: true,
        category: cat(
          "localizacao",
          "Localização",
          true,
          "Localização limítrofe da pretendida",
          Math.round(weight * 0.75),
          weight,
        ),
      };
    }
  }

  return {
    ok: false,
    rejectReason: "LOCALIZACAO",
    category: cat("localizacao", "Localização", false, "Localização fora da área pretendida"),
  };
}

function areaMinFilter(buyer: BuyerLike, property: PropertyLike): HardFilterResult {
  const areaMin = num(buyer.area_min);
  if (areaMin == null) {
    return { ok: true, category: cat("area", "Área", true, "Sem mínimo pedido") };
  }
  // Correções 1.3: para terrenos, quintas e herdades a área relevante é a
  // do TERRENO — não a área útil. O CRM pode expor ambas; o motor escolhe
  // consoante o tipo de imóvel.
  const tipo = (property.tipo_imovel ?? "").toLowerCase();
  const isTerrainType = tipo === "terreno" || tipo === "quinta" || tipo === "herdade";
  const pArea = isTerrainType
    ? num(property.area_terreno_m2) ?? num(property.area_util_m2) ?? num(property.area_m2)
    : num(property.area_util_m2) ?? num(property.area_m2);
  if (pArea == null) {
    return {
      ok: false,
      rejectReason: "AREA",
      needsReview: { reviewReason: "area_em_falta", reason: "Área do imóvel em falta" },
      category: cat("area", "Área", false, "Imóvel sem área declarada — revisão manual"),
    };
  }
  if (pArea < areaMin) {
    return { ok: false, rejectReason: "AREA", category: cat("area", "Área", false, `${pArea} m² < ${areaMin} m² pedidos`) };
  }
  return { ok: true, category: cat("area", "Área", true, `${pArea} m² (≥ ${areaMin})`) };
}

function precoMaxFilter(buyer: BuyerLike, property: PropertyLike, tolerance: number): HardFilterResult {
  const price = num(property.preco);
  const budgetMax = num(buyer.budget_max);
  if (budgetMax == null) {
    return { ok: true, category: cat("preco", "Preço", true, "Sem orçamento") };
  }
  if (price == null) {
    return { ok: false, rejectReason: "ORCAMENTO", category: cat("preco", "Preço", false, "Imóvel sem preço definido") };
  }
  const cap = budgetMax * (1 + Math.max(0, tolerance));
  if (price > cap) {
    return { ok: false, rejectReason: "ORCAMENTO", category: cat("preco", "Preço", false, `Acima do orçamento (${Math.round(((price - budgetMax) / budgetMax) * 100)}%)`) };
  }
  return { ok: true, category: cat("preco", "Preço", true, "Dentro do orçamento") };
}

// Registo declarativo de características obrigatórias — acrescentar aqui
// futuros hard filters de features (piscina obrigatória, etc.) não requer
// mudança no motor.
const REQUIRED_FEATURES: Array<{ buyerField: keyof BuyerLike; propField: keyof PropertyLike; label: string }> = [
  { buyerField: "garagem_obrigatoria", propField: "garagem", label: "garagem" },
  { buyerField: "elevador_obrigatorio", propField: "elevador", label: "elevador" },
];

function featuresFilter(buyer: BuyerLike, property: PropertyLike): HardFilterResult {
  const missing: string[] = [];
  for (const f of REQUIRED_FEATURES) {
    if ((buyer as any)[f.buyerField]) {
      if (!(property as any)[f.propField]) missing.push(f.label);
    }
  }
  if (missing.length > 0) {
    return { ok: false, rejectReason: "CARACTERISTICAS", category: cat("extras", "Características", false, `Falta: ${missing.join(", ")}`) };
  }
  return { ok: true, category: cat("extras", "Características", true, "Requisitos obrigatórios cumpridos") };
}

// Deteta procuras de investidor/promotor que visam projetos ou
// empreendimentos completos, não unidades residenciais avulsas. Estas
// procuras não devem ser cruzadas com apartamentos ou moradias
// individuais — só com Terreno, Prédio ou Espaço comercial.
export function isInvestorBulkSearch(buyer: BuyerLike): boolean {
  const parts: string[] = [];
  if (Array.isArray(buyer.caracteristicas)) parts.push(...buyer.caracteristicas.map(String));
  if (typeof buyer.resumo === "string") parts.push(buyer.resumo);
  if (typeof buyer.texto_original === "string") parts.push(buyer.texto_original);
  if (parts.length === 0) return false;
  const t = parts.join(" | ").toLowerCase();
  const signals: RegExp[] = [
    /\bfra[cç][aãoõ]es\b/,
    /empreendiment/,
    /projet[oa]s?\s+aprovad/,
    /retail\s*park/,
    /pr[eé]dio\s+(inteiro|completo|para\s+investiment)/,
    /investidor/,
    /pack\s+de\s+im[oó]veis/,
    /portef[oó]lio\s+de\s+im[oó]veis/,
  ];
  return signals.some((re) => re.test(t));
}

function investorBulkFilter(buyer: BuyerLike, property: PropertyLike): HardFilterResult {
  if (!isInvestorBulkSearch(buyer)) {
    return { ok: true, category: cat("tipo", "Tipo", true, "Sem sinal de investidor/bulk") };
  }
  const pTipo = (property.tipo_imovel ?? "").toLowerCase();
  const bulkAllowed = new Set(["terreno", "predio", "prédio", "espaco comercial", "espaço comercial"]);
  if (bulkAllowed.has(pTipo)) {
    return { ok: true, category: cat("tipo", "Tipo", true, `Compatível com procura de investidor (${property.tipo_imovel})`) };
  }
  return {
    ok: false,
    rejectReason: "INVESTIDOR_BULK",
    category: cat(
      "tipo",
      "Tipo",
      false,
      `Procura de investidor/empreendimento — não elegível para ${property.tipo_imovel ?? "unidade avulsa"}`,
    ),
  };
}

// ORDEM ESTRITA. Falha em qualquer um → oportunidade não é gerada.
export const HARD_FILTERS: HardFilter[] = [
  { name: "finalidade", key: "finalidade", run: finalidadeFilter },
  { name: "tipo", key: "tipo", run: tipoFilter },
  { name: "investor_bulk", key: "tipo", run: investorBulkFilter },
  { name: "localizacao", key: "localizacao", run: (b, p, ctx) => localizacaoFilter(b, p, ctx) },
  { name: "area_min", key: "area", run: areaMinFilter },
  { name: "features", key: "extras", run: featuresFilter },
  // preço é adicionado dinamicamente por causa da tolerância
];

// ---------- Soft scoring (só corre depois de TODOS os hard filters passarem) ----------

function scoreTipologia(buyer: BuyerLike, property: PropertyLike): MatchCategoryResult {
  const weight = WEIGHTS.tipologia;
  // Correções 1.3: para imóveis do tipo terreno/quinta/herdade, o número
  // de quartos NÃO é o critério principal — o que define o imóvel é o
  // tipo e a área do terreno. Devolvemos peso pleno sem comparar T-x.
  const pTipo = (property.tipo_imovel ?? "").toLowerCase();
  if (pTipo === "terreno" || pTipo === "quinta" || pTipo === "herdade") {
    const label = property.tipo_imovel
      ? property.tipo_imovel.charAt(0).toUpperCase() + property.tipo_imovel.slice(1)
      : "—";
    return cat("tipologia", "Tipo", true, label, weight, weight);
  }
  const bQ = sanitizeQuartos(buyer.quartos_min ?? null, "buyer.quartos_min")
    ?? tipologiaQuartos(buyer.tipologia);
  const pQ = sanitizeQuartos(property.quartos ?? null, "property.quartos")
    ?? tipologiaQuartos(property.tipologia);
  if (bQ == null) {
    return cat("tipologia", "Tipologia", true, property.tipologia ?? (pQ != null ? `${pQ} quartos` : "—"), weight, weight);
  }
  if (pQ == null) {
    return cat("tipologia", "Tipologia", true, "Tipologia do imóvel não declarada", Math.round(weight * 0.6), weight);
  }
  if (pQ < bQ) {
    return cat("tipologia", "Tipologia", false, `Tipologia inferior (T${pQ} < T${bQ})`, 0, weight);
  }
  const diff = pQ - bQ;
  const s = diff === 0 ? weight : diff === 1 ? Math.round(weight * 0.9) : Math.round(weight * 0.75);
  const detail = diff === 0
    ? property.tipologia ?? `T${pQ}`
    : `${property.tipologia ?? `T${pQ}`} (superior ao pedido T${bQ})`;
  return cat("tipologia", "Tipologia", true, detail, s, weight);
}

function scorePreco(buyer: BuyerLike, property: PropertyLike): MatchCategoryResult {
  const weight = WEIGHTS.preco;
  const price = num(property.preco);
  const budgetMax = num(buyer.budget_max);
  const budgetMin = num(buyer.budget_min);
  if (price == null || budgetMax == null) {
    return cat("preco", "Preço", true, "Sem dados de preço", weight, weight);
  }
  if (price > budgetMax) {
    return cat("preco", "Preço", true, `Dentro da tolerância (+${Math.round(((price - budgetMax) / budgetMax) * 100)}%)`, Math.round(weight * 0.85), weight);
  }
  if (budgetMin != null && price < budgetMin * 0.7) {
    return cat("preco", "Preço", true, "Abaixo do intervalo pretendido", Math.round(weight * 0.6), weight);
  }
  return cat("preco", "Preço", true, "Dentro do orçamento", weight, weight);
}

function scoreArea(buyer: BuyerLike, property: PropertyLike): MatchCategoryResult {
  const weight = WEIGHTS.area;
  const tipo = (property.tipo_imovel ?? "").toLowerCase();
  const isTerrainType = tipo === "terreno" || tipo === "quinta" || tipo === "herdade";
  const pArea = isTerrainType
    ? num(property.area_terreno_m2) ?? num(property.area_util_m2) ?? num(property.area_m2)
    : num(property.area_util_m2) ?? num(property.area_m2);
  const areaMin = num(buyer.area_min);
  if (pArea == null || areaMin == null) {
    return cat("area", "Área", true, pArea != null ? `${pArea} m²` : "Sem dados", Math.round(weight * 0.7), weight);
  }
  return cat("area", "Área", true, `${pArea} m² (≥ ${areaMin})`, weight, weight);
}

function scoreExtras(buyer: BuyerLike, property: PropertyLike): MatchCategoryResult {
  const weight = WEIGHTS.extras;
  const per = weight / 4;
  let s = 0;
  const parts: string[] = [];
  const applyReq = (
    required: boolean | null | undefined,
    has: boolean | null | undefined,
    label: string,
  ) => {
    if (required) {
      if (has === true) {
        s += per;
        parts.push(`✓ ${label}`);
      }
      // Se required && !has → já teria falhado no featuresFilter.
    } else if (has === true) {
      s += per * 0.3;
      parts.push(label);
    }
  };
  applyReq(buyer.garagem_obrigatoria, property.garagem, "garagem");
  applyReq(buyer.elevador_obrigatorio, property.elevador, "elevador");
  if (property.jardim) { s += per * 0.3; parts.push("jardim"); }
  if (property.piscina) { s += per * 0.3; parts.push("piscina"); }
  const score = Math.max(0, Math.min(weight, Math.round(s)));
  return cat("extras", "Extras", true, parts.join(", ") || "Sem extras relevantes", score, weight);
}

// ---------- Entry point ----------

export function scoreMatch(
  buyer: BuyerLike,
  property: PropertyLike,
  options: MatchOptions = {},
): MatchScore {
  const tolerance = options.priceTolerance ?? 0.1;
  const geoIndex = options.geoIndex ?? null;

  // Corre a lista configurável de hard filters, em ordem estrita.
  const passed: MatchCategoryResult[] = [];
  for (const f of HARD_FILTERS) {
    const r = f.run(buyer, property, geoIndex);
    if (!r.ok) {
      return fail(r.category.key, r.category.label, r.category.detail, r.rejectReason, r.needsReview ?? null);
    }
    passed.push(r.category);
  }
  // Filtro de preço (usa tolerância configurável)
  const precoR = precoMaxFilter(buyer, property, tolerance);
  if (!precoR.ok) {
    return fail(precoR.category.key, precoR.category.label, precoR.category.detail, precoR.rejectReason, precoR.needsReview ?? null);
  }
  passed.push(precoR.category);

  // Todos os hard filters passaram → soft scoring.
  const tip = scoreTipologia(buyer, property);
  if (!tip.ok) {
    // Ainda que a tipologia seja hard-ish (não apresentar T2 quando pediu T3),
    // tratamos como falha eliminatória de compatibilidade.
    return fail("tipologia", "Tipologia", tip.detail, "TIPOLOGIA");
  }
  const preco = scorePreco(buyer, property);
  const area = scoreArea(buyer, property);
  const extras = scoreExtras(buyer, property);

  // Reconstruir categorias com os soft scores para as métricas visuais.
  const categories: MatchCategoryResult[] = [];
  for (const c of passed) {
    if (c.key === "localizacao") categories.push({ ...c }); // já traz soft score
    else if (c.key === "preco") categories.push(preco);
    else if (c.key === "area") categories.push(area);
    else if (c.key === "extras") categories.push(extras);
    else categories.push(c);
  }
  // Adicionar tipologia (não é hard filter no registry)
  categories.push(tip);

  const locScore = categories.find((c) => c.key === "localizacao")?.score ?? 0;
  const total = locScore + tip.score + preco.score + area.score + extras.score;
  const score = Math.max(0, Math.min(100, Math.round(total)));
  const reasons = categories.filter((c) => c.ok && c.detail).map((c) => c.detail);
  // Critério de proximidade — nunca elimina, apenas informa.
  const proximity = (buyer as any).proximity;
  if (Array.isArray(proximity) && proximity.length > 0) {
    reasons.push("Critério de proximidade ainda não validado");
  }

  return { score, compatible: true, needsReview: null, categories, reasons, rejectReason: null };
}

// ---------------------------------------------------------------------------
// Sprint 1.2.1 — Auditoria Completa (evaluateExhaustive)
//
// Corre TODOS os filtros (hard + preço + soft) sem short-circuit, produzindo
// evidência filtro-a-filtro (procura, imóvel, regra, PASS/FAIL). Nunca
// substitui `scoreMatch` — este é usado sob demanda pela UI de Auditoria.
// ---------------------------------------------------------------------------

export type AuditCategoryResult = MatchCategoryResult & {
  expected: string | null;
  actual: string | null;
  rule: string | null;
};

export type ShortCircuit = {
  key: MatchCategoryKey;
  label: string;
  rejectReason: RejectReason;
  detail: string;
};

export type AuditResult = {
  compatible: boolean;
  score: number;
  rejectReason: RejectReason | null;
  /** Filtro que travaria o motor em modo normal (short-circuit). Null se compatible. */
  shortCircuitAt: ShortCircuit | null;
  /** Todas as categorias avaliadas, na ordem: finalidade, tipo, investor_bulk, localização, área, extras, preço, tipologia. */
  categories: AuditCategoryResult[];
  reasons: string[];
  needsReview: NeedsReview | null;
  passedCount: number;
  failedCount: number;
};

// Formatadores utilitários — usados só na auditoria (sem impacto no motor).
function fmtMoney(v: number | string | null | undefined): string {
  const n = num(v);
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("pt-PT", {
      style: "currency", currency: "EUR", maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)} €`;
  }
}
function fmtM2(v: number | string | null | undefined): string {
  const n = num(v);
  return n == null ? "—" : `${Math.round(n)} m²`;
}
function fmtArr(v: string[] | null | undefined): string {
  if (!Array.isArray(v) || v.length === 0) return "—";
  return v.join(", ");
}
function fmtBool(v: boolean | null | undefined): string {
  return v === true ? "sim" : v === false ? "não" : "—";
}
function fmtLocIds(ids: string[] | null | undefined, geoIndex: GeoMatchIndex | null): string {
  if (!Array.isArray(ids) || ids.length === 0) return "—";
  const names = ids.map((id) => geoIndex?.nameOf(id) ?? id.slice(0, 8)).filter(Boolean);
  return names.join(", ");
}
function fmtLocId(id: string | null | undefined, geoIndex: GeoMatchIndex | null): string {
  if (!id) return "—";
  return geoIndex?.nameOf(id) ?? id.slice(0, 8);
}

/**
 * Devolve {expected, actual, rule} legíveis para uma categoria auditada.
 * Pura: só depende de buyer/property/geoIndex.
 */
export function deriveExpectedActual(
  key: MatchCategoryKey,
  buyer: BuyerLike,
  property: PropertyLike,
  geoIndex: GeoMatchIndex | null,
): { expected: string; actual: string; rule: string } {
  switch (key) {
    case "finalidade":
      return {
        expected: (buyer.finalidade ?? "—").toString(),
        actual: (property.finalidade ?? "—").toString(),
        rule: "Procura = Imóvel (ou procura ambos)",
      };
    case "tipo":
      return {
        expected: fmtArr(buyer.tipo_imovel ?? null),
        actual: (property.tipo_imovel ?? "—").toString(),
        rule: "Imóvel ∈ tipos pretendidos (exceção: rústico permite tipo vazio)",
      };
    case "tipologia": {
      const bQ = sanitizeQuartos(buyer.quartos_min ?? null, "buyer.quartos_min")
        ?? tipologiaQuartos(buyer.tipologia);
      const pQ = sanitizeQuartos(property.quartos ?? null, "property.quartos")
        ?? tipologiaQuartos(property.tipologia);
      return {
        expected: buyer.tipologia
          ? String(buyer.tipologia)
          : bQ != null ? `T${bQ}+` : "—",
        actual: property.tipologia
          ? String(property.tipologia)
          : pQ != null ? `T${pQ}` : "—",
        rule: "Imóvel ≥ Procura (tolerante se procura indefinida)",
      };
    }
    case "preco": {
      const bmin = buyer.budget_min != null ? fmtMoney(buyer.budget_min) : null;
      const bmax = buyer.budget_max != null ? fmtMoney(buyer.budget_max) : null;
      const exp = bmin && bmax
        ? `${bmin} – ${bmax}`
        : bmax ? `até ${bmax}`
        : bmin ? `desde ${bmin}` : "sem limite";
      return {
        expected: exp,
        actual: fmtMoney(property.preco),
        rule: "Preço ≤ orçamento máximo × 1,10",
      };
    }
    case "area": {
      const tipo = (property.tipo_imovel ?? "").toString().toLowerCase();
      const isTerrain = tipo === "terreno" || tipo === "quinta" || tipo === "herdade";
      const pArea = isTerrain
        ? num(property.area_terreno_m2) ?? num(property.area_util_m2) ?? num(property.area_m2)
        : num(property.area_util_m2) ?? num(property.area_m2);
      return {
        expected: buyer.area_min != null ? `≥ ${fmtM2(buyer.area_min)}` : "sem mínimo",
        actual: fmtM2(pArea),
        rule: isTerrain ? "Área do terreno ≥ mínimo" : "Área útil ≥ mínimo",
      };
    }
    case "localizacao":
      return {
        expected: fmtLocIds(buyer.location_ids ?? null, geoIndex),
        actual: fmtLocId(property.location_id ?? null, geoIndex),
        rule: "Match directo → hierarquia → zona funcional → adjacência",
      };
    case "extras": {
      const req: string[] = [];
      if (buyer.garagem_obrigatoria) req.push("garagem");
      if (buyer.elevador_obrigatorio) req.push("elevador");
      const has: string[] = [];
      if (property.garagem) has.push("garagem");
      if (property.elevador) has.push("elevador");
      if (property.jardim) has.push("jardim");
      if (property.piscina) has.push("piscina");
      return {
        expected: req.length ? `obrigatório: ${req.join(", ")}` : "sem requisitos",
        actual: has.length ? has.join(", ") : "—",
        rule: "Requisitos obrigatórios do comprador cumpridos pelo imóvel",
      };
    }
  }
  // Fallback (para exhaustiveness)
  return { expected: "—", actual: "—", rule: "" };
}

function toAudit(
  cat: MatchCategoryResult,
  buyer: BuyerLike,
  property: PropertyLike,
  geoIndex: GeoMatchIndex | null,
): AuditCategoryResult {
  const d = deriveExpectedActual(cat.key, buyer, property, geoIndex);
  return { ...cat, expected: d.expected, actual: d.actual, rule: d.rule };
}

/**
 * Sprint 1.2.1 — Auditoria Completa.
 *
 * Ordem exaustiva: HARD_FILTERS → preço → tipologia (soft-hard) → soft (área/extras).
 * NUNCA interrompe. Devolve `shortCircuitAt` com o filtro que teria travado
 * o motor em modo normal, para comparação directa.
 */
export function evaluateExhaustive(
  buyer: BuyerLike,
  property: PropertyLike,
  options: MatchOptions = {},
): AuditResult {
  const tolerance = options.priceTolerance ?? 0.1;
  const geoIndex = options.geoIndex ?? null;

  const audit: AuditCategoryResult[] = [];
  let shortCircuitAt: ShortCircuit | null = null;
  let firstRejectReason: RejectReason | null = null;
  let hardCompatible = true;
  let needsReview: NeedsReview | null = null;

  const record = (
    res: HardFilterResult,
    _stage: "hard" | "preco" | "tipologia",
  ) => {
    const c = toAudit(res.category, buyer, property, geoIndex);
    audit.push(c);
    if (!res.ok) {
      hardCompatible = false;
      if (!shortCircuitAt) {
        shortCircuitAt = {
          key: res.category.key,
          label: res.category.label,
          rejectReason: res.rejectReason,
          detail: res.category.detail,
        };
        firstRejectReason = res.rejectReason;
        if (res.needsReview && !needsReview) needsReview = res.needsReview;
      }
    }
  };

  // 1) Hard filters registados (ordem estrita)
  for (const f of HARD_FILTERS) {
    record(f.run(buyer, property, geoIndex), "hard");
  }
  // 2) Preço (hard, com tolerância)
  record(precoMaxFilter(buyer, property, tolerance), "preco");

  // 3) Tipologia — é hard-ish (falha se imóvel inferior ao pedido).
  //    scoreMatch trata-o como falha eliminatória; replicamos essa semântica
  //    aqui, mas sem short-circuit — a categoria continua a ser reportada.
  const tipCat = scoreTipologia(buyer, property);
  const tipAudit: AuditCategoryResult = toAudit(tipCat, buyer, property, geoIndex);
  audit.push(tipAudit);
  if (!tipCat.ok) {
    hardCompatible = false;
    if (!shortCircuitAt) {
      shortCircuitAt = {
        key: "tipologia",
        label: "Tipologia",
        rejectReason: "TIPOLOGIA",
        detail: tipCat.detail,
      };
      firstRejectReason = "TIPOLOGIA";
    }
  }

  // 4) Soft scores adicionais (área/extras) — só afetam score final.
  //    Estas categorias já podem ter sido acrescentadas como hard;
  //    substituímos pelas versões com peso soft para o score.
  const softPreco = scorePreco(buyer, property);
  const softArea = scoreArea(buyer, property);
  const softExtras = scoreExtras(buyer, property);

  // Substitui as versões hard das categorias soft-scoring pelas versões com peso.
  const finalCategories: AuditCategoryResult[] = audit.map((c) => {
    if (c.key === "preco") return { ...toAudit(softPreco, buyer, property, geoIndex), ok: c.ok };
    if (c.key === "area") return { ...toAudit(softArea, buyer, property, geoIndex), ok: c.ok };
    if (c.key === "extras") return { ...toAudit(softExtras, buyer, property, geoIndex), ok: c.ok };
    return c;
  });

  const compatible = hardCompatible;
  let score = 0;
  if (compatible) {
    const locScore = finalCategories.find((c) => c.key === "localizacao")?.score ?? 0;
    score = Math.max(
      0,
      Math.min(
        100,
        Math.round(locScore + tipAudit.score + softPreco.score + softArea.score + softExtras.score),
      ),
    );
  }

  const reasons = compatible
    ? finalCategories.filter((c) => c.ok && c.detail).map((c) => c.detail)
    : [];

  const passedCount = finalCategories.filter((c) => c.ok).length;
  const failedCount = finalCategories.length - passedCount;

  return {
    compatible,
    score,
    rejectReason: compatible ? null : firstRejectReason,
    shortCircuitAt,
    categories: finalCategories,
    reasons,
    needsReview,
    passedCount,
    failedCount,
  };
}