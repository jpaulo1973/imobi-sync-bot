// Motor de compatibilidade Property Match.
//
// Filosofia: qualidade > quantidade. Antes de pontuar, aplica Hard Filters
// pela ordem definida no briefing (Sprint — Hard Filters de Compatibilidade):
//
//   1) Finalidade  2) Tipo de imóvel  3) Tipologia  4) Orçamento  5) Localização
//
// Só imóveis que sobrevivem a TODOS os filtros recebem pontuação. A percentagem
// de Match reflecte apenas critérios "soft" (nível de localização, tipologia
// exata vs superior, área, extras) — os Hard Filters não somam pontos.

import { locationLevel, normalizeLocation } from "./location-graph";

export type BuyerLike = {
  finalidade?: string | null;
  tipo_imovel?: string[] | null;
  tipologia?: string | null;
  zona?: string | null;
  budget_min?: number | string | null;
  budget_max?: number | string | null;
  area_min?: number | string | null;
  quartos_min?: number | null;
  garagem_obrigatoria?: boolean | null;
  elevador_obrigatorio?: boolean | null;
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

export type MatchScore = {
  score: number; // 0-100
  compatible: boolean;
  categories: MatchCategoryResult[];
  reasons: string[];
};

export type MatchOptions = {
  /** Permite apresentar zonas de Nível 3 (mercados próximos mas distintos). */
  expandSearch?: boolean;
  /**
   * Tolerância adicional ao orçamento máximo (0-1). Por defeito 0.10
   * (regra de negócio do Property Match — margem inteligente de 10%).
   */
  priceTolerance?: number;
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

function tokens(v: string | null | undefined): string[] {
  return normalizeLocation(v)
    .split(/[,;/|]+/)
    .map((s: string) => s.trim())
    .filter(Boolean);
}

function fail(key: MatchCategoryKey, label: string, detail: string): MatchScore {
  return {
    score: 0,
    compatible: false,
    categories: [{ key, label, ok: false, detail, score: 0, weight: 0 }],
    reasons: [],
  };
}

// ---------- Hard Filters ----------

function checkFinalidade(buyer: BuyerLike, property: PropertyLike): MatchCategoryResult | string {
  if (buyer.finalidade && property.finalidade && buyer.finalidade !== property.finalidade) {
    return `Finalidade incompatível (${property.finalidade})`;
  }
  return {
    key: "finalidade",
    label: "Finalidade",
    ok: true,
    detail: property.finalidade ?? "—",
    score: 0,
    weight: 0,
  };
}

function checkTipo(buyer: BuyerLike, property: PropertyLike): MatchCategoryResult | string {
  const buyerTipos = (buyer.tipo_imovel ?? []).map(normalizeLocation).filter(Boolean);
  const pTipo = normalizeLocation(property.tipo_imovel);
  if (buyerTipos.length === 0) {
    return { key: "tipo", label: "Tipo", ok: true, detail: property.tipo_imovel ?? "—", score: 0, weight: 0 };
  }
  if (!pTipo) return "Tipo do imóvel não declarado";
  if (!buyerTipos.includes(pTipo)) return `Tipo ${property.tipo_imovel} fora do pedido`;
  return { key: "tipo", label: "Tipo", ok: true, detail: property.tipo_imovel!, score: 0, weight: 0 };
}

function checkTipologia(
  buyer: BuyerLike,
  property: PropertyLike,
): { category: MatchCategoryResult; softScore: number } | string {
  const bQ = buyer.quartos_min ?? tipologiaQuartos(buyer.tipologia);
  const pQ = property.quartos ?? tipologiaQuartos(property.tipologia);
  const weight = WEIGHTS.tipologia;

  // Sem preferência do comprador → aceita tudo, score cheio nesta categoria.
  if (bQ == null) {
    return {
      category: {
        key: "tipologia",
        label: "Tipologia",
        ok: true,
        detail: property.tipologia ?? (pQ != null ? `${pQ} quartos` : "—"),
        score: weight,
        weight,
      },
      softScore: weight,
    };
  }
  // Comprador pediu tipologia mas o imóvel não a declara → excluir.
  if (pQ == null) return "Tipologia do imóvel não declarada";
  // Regra de compatibilidade ascendente: nunca apresentar tipologia inferior.
  if (pQ < bQ) return `Tipologia inferior (T${pQ} < T${bQ})`;

  const diff = pQ - bQ;
  const softScore = diff === 0 ? weight : diff === 1 ? Math.round(weight * 0.9) : Math.round(weight * 0.75);
  const detail =
    diff === 0
      ? property.tipologia ?? `T${pQ}`
      : `${property.tipologia ?? `T${pQ}`} (superior ao pedido T${bQ})`;
  return {
    category: { key: "tipologia", label: "Tipologia", ok: true, detail, score: softScore, weight },
    softScore,
  };
}

function checkPreco(
  buyer: BuyerLike,
  property: PropertyLike,
  tolerance: number,
): { category: MatchCategoryResult; softScore: number } | string {
  const weight = WEIGHTS.preco;
  const price = num(property.preco);
  const budgetMax = num(buyer.budget_max);
  const budgetMin = num(buyer.budget_min);

  if (price == null) return "Imóvel sem preço definido";
  if (budgetMax == null) {
    return {
      category: { key: "preco", label: "Preço", ok: true, detail: "Sem orçamento", score: weight, weight },
      softScore: weight,
    };
  }

  const cap = budgetMax * (1 + Math.max(0, tolerance));
  if (price > cap) return `Acima do orçamento (${Math.round(((price - budgetMax) / budgetMax) * 100)}%)`;

  // Score soft: dentro do orçamento máximo é o normal.
  let softScore = weight;
  let detail = "Dentro do orçamento";
  if (price > budgetMax) {
    softScore = Math.round(weight * 0.85);
    detail = `Dentro da tolerância (+${Math.round(((price - budgetMax) / budgetMax) * 100)}%)`;
  } else if (budgetMin != null && price < budgetMin * 0.7) {
    softScore = Math.round(weight * 0.6);
    detail = "Abaixo do intervalo pretendido";
  }
  return {
    category: { key: "preco", label: "Preço", ok: true, detail, score: softScore, weight },
    softScore,
  };
}

function checkLocalizacao(
  buyer: BuyerLike,
  property: PropertyLike,
  expandSearch: boolean,
): { category: MatchCategoryResult; softScore: number } | string {
  const weight = WEIGHTS.localizacao;
  const buyerTokens = tokens(buyer.zona);

  if (buyerTokens.length === 0) {
    return {
      category: {
        key: "localizacao",
        label: "Localização",
        ok: true,
        detail: "Sem preferência de zona",
        score: Math.round(weight * 0.8),
        weight,
      },
      softScore: Math.round(weight * 0.8),
    };
  }

  const pFreg = normalizeLocation(property.freguesia);
  const pZona = normalizeLocation(property.zona);
  const pConc = normalizeLocation(property.concelho);
  const propTokens = [pFreg, pZona, pConc].filter(Boolean);
  if (propTokens.length === 0) return "Imóvel sem localização";

  let bestLevel: 1 | 2 | 3 | null = null;
  let bestDetail = "";
  const consider = (lvl: 1 | 2 | 3, detail: string) => {
    if (bestLevel == null || lvl < bestLevel) {
      bestLevel = lvl;
      bestDetail = detail;
    }
  };

  for (const bt of buyerTokens) {
    for (const pt of propTokens) {
      const lvl = locationLevel(bt, pt);
      if (lvl != null) {
        const labelSrc = property.freguesia ?? property.zona ?? property.concelho ?? pt;
        consider(
          lvl,
          lvl === 1 ? labelSrc : lvl === 2 ? `${labelSrc} (mercado relacionado)` : `${labelSrc} (mercado próximo)`,
        );
      }
    }
  }

  if (bestLevel == null) return "Fora da zona pretendida";
  if (bestLevel === 3 && !expandSearch) return "Fora da zona pretendida (mercado distinto)";

  const softScore =
    bestLevel === 1 ? weight : bestLevel === 2 ? Math.round(weight * 0.8) : Math.round(weight * 0.5);
  return {
    category: { key: "localizacao", label: "Localização", ok: true, detail: bestDetail, score: softScore, weight },
    softScore,
  };
}

// ---------- Soft scoring ----------

function scoreArea(buyer: BuyerLike, property: PropertyLike): MatchCategoryResult {
  const weight = WEIGHTS.area;
  const pArea = num(property.area_util_m2) ?? num(property.area_m2);
  const areaMin = num(buyer.area_min);
  if (pArea == null || areaMin == null) {
    return {
      key: "area",
      label: "Área",
      ok: true,
      detail: pArea != null ? `${pArea} m²` : "Sem dados",
      score: Math.round(weight * 0.7),
      weight,
    };
  }
  if (pArea >= areaMin) {
    return { key: "area", label: "Área", ok: true, detail: `${pArea} m² (≥ ${areaMin})`, score: weight, weight };
  }
  const ratio = pArea / areaMin;
  if (ratio >= 0.9)
    return {
      key: "area",
      label: "Área",
      ok: false,
      detail: `${pArea} m² (ligeiramente abaixo)`,
      score: Math.round(weight * 0.65),
      weight,
    };
  return {
    key: "area",
    label: "Área",
    ok: false,
    detail: `${pArea} m² abaixo de ${areaMin}`,
    score: Math.round(weight * 0.3),
    weight,
  };
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
      } else {
        s -= per * 0.5;
        parts.push(`sem ${label}`);
      }
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
  return {
    key: "extras",
    label: "Extras",
    ok: score >= per,
    detail: parts.join(", ") || "Sem extras relevantes",
    score,
    weight,
  };
}

// ---------- Entry point ----------

export function scoreMatch(
  buyer: BuyerLike,
  property: PropertyLike,
  options: MatchOptions = {},
): MatchScore {
  const tolerance = options.priceTolerance ?? 0.1;
  const expandSearch = options.expandSearch ?? false;

  // 1) Finalidade
  const fin = checkFinalidade(buyer, property);
  if (typeof fin === "string") return fail("finalidade", "Finalidade", fin);

  // 2) Tipo de imóvel
  const tipo = checkTipo(buyer, property);
  if (typeof tipo === "string") return fail("tipo", "Tipo", tipo);

  // 3) Tipologia (compatibilidade ascendente)
  const tip = checkTipologia(buyer, property);
  if (typeof tip === "string") return fail("tipologia", "Tipologia", tip);

  // 4) Orçamento
  const preco = checkPreco(buyer, property, tolerance);
  if (typeof preco === "string") return fail("preco", "Preço", preco);

  // 5) Localização
  const loc = checkLocalizacao(buyer, property, expandSearch);
  if (typeof loc === "string") return fail("localizacao", "Localização", loc);

  // Soft
  const area = scoreArea(buyer, property);
  const extras = scoreExtras(buyer, property);

  const categories: MatchCategoryResult[] = [
    fin,
    tipo,
    loc.category,
    tip.category,
    preco.category,
    area,
    extras,
  ];

  const total = loc.softScore + tip.softScore + preco.softScore + area.score + extras.score;
  const score = Math.max(0, Math.min(100, Math.round(total)));
  const reasons = categories.filter((c) => c.ok && c.detail).map((c) => c.detail);

  return { score, compatible: true, categories, reasons };
}