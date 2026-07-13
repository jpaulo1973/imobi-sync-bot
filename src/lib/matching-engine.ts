// Motor de compatibilidade Property Match — Release 1.2.1.
//
// Arquitetura: registo configurável de Hard Filters. Cada filtro devolve
// {ok:true} | {ok:false, reason} | {ok:false, needsReview, reviewReason, reason}.
// Um único filtro falhado impede totalmente a geração da oportunidade.
// Só depois de TODOS passarem é calculado o soft score (0-100).
//
// Adicionar um novo Hard Filter = juntar entrada em HARD_FILTERS. O motor
// não precisa de mudar.

import { areFreguesiasAdjacent, isKnownConcelho, normalizeLocation } from "./location-graph";
import {
  coverageIncludesProperty,
  resolveZone,
  type ZoneResolverContext,
} from "./functional-zones";

export type BuyerLike = {
  finalidade?: string | null;
  tipo_imovel?: string[] | null;
  tipologia?: string | null;
  zona?: string | null;
  freguesia?: string | null;
  municipio?: string | null;
  concelho?: string | null;
  budget_min?: number | string | null;
  budget_max?: number | string | null;
  area_min?: number | string | null;
  quartos_min?: number | null;
  garagem_obrigatoria?: boolean | null;
  elevador_obrigatorio?: boolean | null;
  proximity?: unknown | null;
};

export type PropertyLike = {
  finalidade?: string | null;
  tipo_imovel?: string | null;
  tipologia?: string | null;
  distrito?: string | null;
  concelho?: string | null;
  freguesia?: string | null;
  zona?: string | null;
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

export type MatchScore = {
  score: number; // 0-100
  compatible: boolean;
  needsReview: NeedsReview | null;
  categories: MatchCategoryResult[];
  reasons: string[];
};

export type MatchOptions = {
  /**
   * Tolerância adicional ao orçamento máximo (0-1). Por defeito 0.10
   * (regra de negócio do Property Match — margem inteligente de 10%).
   */
  priceTolerance?: number;
  /**
   * Contexto de zonas funcionais para o motor reconhecer aliases como
   * "Linha de Cascais" ou "Margem Sul". Pré-carregado uma vez por request.
   */
  zoneContext?: ZoneResolverContext | null;
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

function tipologiaQuartos(t: string | null | undefined): number | null {
  const m = /^t(\d+)/i.exec((t ?? "").trim());
  return m ? Number(m[1]) : null;
}

function fail(key: MatchCategoryKey, label: string, detail: string, needsReview: NeedsReview | null = null): MatchScore {
  return {
    score: 0,
    compatible: false,
    needsReview,
    categories: [{ key, label, ok: false, detail, score: 0, weight: 0 }],
    reasons: [],
  };
}

// ---------- Hard Filters (configurable registry) ----------

export type HardFilterOk = { ok: true; category: MatchCategoryResult };
export type HardFilterFail = { ok: false; category: MatchCategoryResult; needsReview?: NeedsReview };
export type HardFilterResult = HardFilterOk | HardFilterFail;

export type HardFilter = {
  name: string;
  key: MatchCategoryKey;
  run: (buyer: BuyerLike, property: PropertyLike, ctx?: ZoneResolverContext | null) => HardFilterResult;
};

function finalidadeFilter(buyer: BuyerLike, property: PropertyLike): HardFilterResult {
  const b = (buyer.finalidade ?? "").toString().toLowerCase();
  const p = (property.finalidade ?? "").toString().toLowerCase();
  if (!b || b === "indefinido") {
    return { ok: false, category: cat("finalidade", "Finalidade", false, "Finalidade da procura não indicada") };
  }
  if (!p) {
    return { ok: false, category: cat("finalidade", "Finalidade", false, "Finalidade do imóvel não indicada") };
  }
  const buyerAcceptsBoth = b === "ambos" || b === "venda_arrendamento";
  if (!buyerAcceptsBoth && b !== p) {
    return { ok: false, category: cat("finalidade", "Finalidade", false, `Finalidade incompatível (procura ${b}, imóvel ${p})`) };
  }
  return { ok: true, category: cat("finalidade", "Finalidade", true, property.finalidade ?? "—") };
}

function tipoFilter(buyer: BuyerLike, property: PropertyLike): HardFilterResult {
  const buyerTipos = (buyer.tipo_imovel ?? []).map(normalizeLocation).filter(Boolean);
  const pTipo = normalizeLocation(property.tipo_imovel);
  const pTipoRaw = (property.tipo_imovel ?? "").toLowerCase();
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
    return { ok: false, category: cat("tipo", "Tipo", false, "Tipo de imóvel não indicado na procura") };
  }
  if (!pTipo) {
    return { ok: false, category: cat("tipo", "Tipo", false, "Tipo do imóvel não declarado") };
  }
  if (!buyerTipos.includes(pTipo)) {
    return { ok: false, category: cat("tipo", "Tipo", false, `Tipo ${property.tipo_imovel} fora do pedido`) };
  }
  return { ok: true, category: cat("tipo", "Tipo", true, property.tipo_imovel!) };
}

function cat(key: MatchCategoryKey, label: string, ok: boolean, detail: string, score = 0, weight = 0): MatchCategoryResult {
  return { key, label, ok, detail, score, weight };
}

function localizacaoFilter(
  buyer: BuyerLike,
  property: PropertyLike,
  zoneContext?: ZoneResolverContext | null,
): HardFilterResult {
  const bZone = normalizeLocation(buyer.zona ?? buyer.freguesia ?? buyer.municipio);
  if (!bZone) {
    return { ok: false, category: cat("localizacao", "Localização", false, "Localização não indicada na procura") };
  }

  const pFreg = normalizeLocation(property.freguesia);
  const pConc = normalizeLocation(property.concelho);
  const pZona = normalizeLocation(property.zona);

  // Modo CONCELHO — comprador aceita qualquer freguesia dentro do concelho.
  if (isKnownConcelho(bZone)) {
    if (pConc && pConc === bZone) {
      const detail = property.freguesia ?? property.concelho ?? bZone;
      const weight = WEIGHTS.localizacao;
      return { ok: true, category: cat("localizacao", "Localização", true, detail, weight, weight) };
    }
    // Também aceitar via zona quando o imóvel só tem zona preenchida.
    if (!pConc && pZona && pZona === bZone) {
      const weight = WEIGHTS.localizacao;
      return { ok: true, category: cat("localizacao", "Localização", true, property.zona ?? bZone, weight, weight) };
    }
    return { ok: false, category: cat("localizacao", "Localização", false, `Fora do concelho (${property.concelho ?? property.zona ?? "?"} ≠ ${buyer.zona})`) };
  }

  // Modo FREGUESIA — comprador pediu uma freguesia específica.
  if (pFreg) {
    if (pFreg === bZone) {
      const weight = WEIGHTS.localizacao;
      return { ok: true, category: cat("localizacao", "Localização", true, property.freguesia ?? bZone, weight, weight) };
    }
    if (areFreguesiasAdjacent(bZone, pFreg)) {
      const weight = WEIGHTS.localizacao;
      return {
        ok: true,
        category: cat("localizacao", "Localização", true, `${property.freguesia} (freguesia limítrofe)`, Math.round(weight * 0.75), weight),
      };
    }
    if (zoneContext) {
      const resolved = resolveZone(bZone, zoneContext);
      if (resolved.source === "functional" && coverageIncludesProperty(resolved, property)) {
        const weight = WEIGHTS.localizacao;
        return {
          ok: true,
          category: cat(
            "localizacao",
            "Localização",
            true,
            `${property.freguesia} (zona funcional: ${resolved.matchedZone?.nome ?? buyer.zona})`,
            Math.round(weight * 0.8),
            weight,
          ),
        };
      }
    }
    return { ok: false, category: cat("localizacao", "Localização", false, `Freguesia diferente (${property.freguesia} ≠ ${buyer.zona})`) };
  }

  // Zona funcional (buyer sem match administrativo direto).
  if (zoneContext) {
    const resolved = resolveZone(bZone, zoneContext);
    if (resolved.source === "functional" && coverageIncludesProperty(resolved, property)) {
      const weight = WEIGHTS.localizacao;
      return {
        ok: true,
        category: cat(
          "localizacao",
          "Localização",
          true,
          `Zona funcional: ${resolved.matchedZone?.nome ?? buyer.zona}`,
          Math.round(weight * 0.8),
          weight,
        ),
      };
    }
  }

  // Imóvel sem freguesia — não podemos afirmar compatibilidade automática,
  // mas o consultor pode querer rever manualmente.
  return {
    ok: false,
    needsReview: { reviewReason: "freguesia_em_falta", reason: "Freguesia do imóvel em falta" },
    category: cat("localizacao", "Localização", false, "Imóvel sem freguesia — revisão manual"),
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
      needsReview: { reviewReason: "area_em_falta", reason: "Área do imóvel em falta" },
      category: cat("area", "Área", false, "Imóvel sem área declarada — revisão manual"),
    };
  }
  if (pArea < areaMin) {
    return { ok: false, category: cat("area", "Área", false, `${pArea} m² < ${areaMin} m² pedidos`) };
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
    return { ok: false, category: cat("preco", "Preço", false, "Imóvel sem preço definido") };
  }
  const cap = budgetMax * (1 + Math.max(0, tolerance));
  if (price > cap) {
    return { ok: false, category: cat("preco", "Preço", false, `Acima do orçamento (${Math.round(((price - budgetMax) / budgetMax) * 100)}%)`) };
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
    return { ok: false, category: cat("extras", "Características", false, `Falta: ${missing.join(", ")}`) };
  }
  return { ok: true, category: cat("extras", "Características", true, "Requisitos obrigatórios cumpridos") };
}

// ORDEM ESTRITA. Falha em qualquer um → oportunidade não é gerada.
export const HARD_FILTERS: HardFilter[] = [
  { name: "finalidade", key: "finalidade", run: finalidadeFilter },
  { name: "tipo", key: "tipo", run: tipoFilter },
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
  const bQ = buyer.quartos_min ?? tipologiaQuartos(buyer.tipologia);
  const pQ = property.quartos ?? tipologiaQuartos(property.tipologia);
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
  const zoneCtx = options.zoneContext ?? null;

  // Corre a lista configurável de hard filters, em ordem estrita.
  const passed: MatchCategoryResult[] = [];
  for (const f of HARD_FILTERS) {
    const r = f.run(buyer, property, zoneCtx);
    if (!r.ok) {
      return fail(r.category.key, r.category.label, r.category.detail, r.needsReview ?? null);
    }
    passed.push(r.category);
  }
  // Filtro de preço (usa tolerância configurável)
  const precoR = precoMaxFilter(buyer, property, tolerance);
  if (!precoR.ok) {
    return fail(precoR.category.key, precoR.category.label, precoR.category.detail, precoR.needsReview ?? null);
  }
  passed.push(precoR.category);

  // Todos os hard filters passaram → soft scoring.
  const tip = scoreTipologia(buyer, property);
  if (!tip.ok) {
    // Ainda que a tipologia seja hard-ish (não apresentar T2 quando pediu T3),
    // tratamos como falha eliminatória de compatibilidade.
    return fail("tipologia", "Tipologia", tip.detail);
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

  return { score, compatible: true, needsReview: null, categories, reasons };
}