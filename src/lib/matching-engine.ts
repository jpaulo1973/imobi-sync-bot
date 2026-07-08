// Motor de compatibilidade Property Match.
// Pura lógica determinística, sem I/O — corre no servidor (server fn) e é
// seguro importar no cliente. Ver `location-graph.ts` para a intel de zona.

import { locationDistance, normalizeLocation } from "./location-graph";

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
  | "localizacao"
  | "preco"
  | "tipo"
  | "tipologia"
  | "area"
  | "extras";

export type MatchCategoryResult = {
  key: MatchCategoryKey;
  label: string;
  ok: boolean; // ✔ verde na UI?
  detail: string;
  score: number;
  weight: number;
};

export type MatchScore = {
  score: number; // 0-100
  compatible: boolean;
  categories: MatchCategoryResult[];
  reasons: string[]; // categorias verdes, curto — compat com UI antiga
};

// Pesos (somam 100). Localização e preço dominam, como um consultor real.
const WEIGHTS: Record<MatchCategoryKey, number> = {
  localizacao: 35,
  preco: 30,
  tipologia: 20,
  area: 8,
  extras: 7,
  tipo: 0, // gate rígido eliminatório, pontuação vive nas outras categorias
};

// Tolerância de preço (configurável num único sítio).
export const PRICE_OVER_FULL = 0.05; // até +5% do budget → conta como dentro
export const PRICE_OVER_SOFT = 0.1; // até +10% → parcial, com aviso
export const PRICE_OVER_MAX = 0.1; // acima disto → ELIMINA (hard cap)

// Limiar mínimo de "compatível" (0-100). Sobe para reduzir falsos positivos.
export const COMPAT_THRESHOLD = 55;

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
    .map((s) => s.trim())
    .filter(Boolean);
}

function scoreLocation(buyer: BuyerLike, property: PropertyLike): MatchCategoryResult {
  const weight = WEIGHTS.localizacao;
  const buyerTokens = tokens(buyer.zona);
  const pFreg = normalizeLocation(property.freguesia);
  const pZona = normalizeLocation(property.zona);
  const pConc = normalizeLocation(property.concelho);
  const pDist = normalizeLocation(property.distrito);
  const propTokens = [pFreg, pZona, pConc, pDist].filter(Boolean);

  if (buyerTokens.length === 0) {
    // sem preferência → não penaliza mas também não é decisivo
    return {
      key: "localizacao",
      label: "Localização",
      ok: true,
      detail: "Sem preferência",
      score: Math.round(weight * 0.5),
      weight,
    };
  }
  if (propTokens.length === 0) {
    return {
      key: "localizacao",
      label: "Localização",
      ok: false,
      detail: "Imóvel sem localização",
      score: 0,
      weight,
    };
  }

  let best = 0;
  let bestDetail = "Fora da zona pretendida";

  const consider = (score: number, detail: string) => {
    if (score > best) {
      best = score;
      bestDetail = detail;
    }
  };

  for (const tk of buyerTokens) {
    // Substring/igualdade contra cada nível do imóvel.
    if (pFreg && (tk === pFreg || pFreg.includes(tk) || tk.includes(pFreg))) {
      consider(weight, `Freguesia ${property.freguesia}`);
    }
    if (pZona && (tk === pZona || pZona.includes(tk) || tk.includes(pZona))) {
      consider(Math.round(weight * 0.9), `Zona ${property.zona}`);
    }
    if (pConc && (tk === pConc || pConc.includes(tk) || tk.includes(pConc))) {
      consider(Math.round(weight * 0.7), `Concelho ${property.concelho}`);
    }
    if (pDist && (tk === pDist || pDist.includes(tk) || tk.includes(pDist))) {
      consider(Math.round(weight * 0.45), `Distrito ${property.distrito}`);
    }
    // Grafo de vizinhança — só se ainda não há match direto forte.
    for (const cand of propTokens) {
      const d = locationDistance(tk, cand, 3);
      const label = property.freguesia ?? property.zona ?? property.concelho ?? "";
      if (d === 1) consider(Math.round(weight * 0.75), `${label} (zona vizinha)`);
      else if (d === 2) consider(Math.round(weight * 0.55), `${label} (próximo)`);
      else if (d === 3) consider(Math.round(weight * 0.35), `${label} (área alargada)`);
    }
  }

  return {
    key: "localizacao",
    label: "Localização",
    ok: best >= Math.round(weight * 0.6),
    detail: bestDetail,
    score: best,
    weight,
  };
}

function scorePreco(
  buyer: BuyerLike,
  property: PropertyLike,
): { result: MatchCategoryResult; eliminate: boolean } {
  const weight = WEIGHTS.preco;
  const price = num(property.preco);
  const budgetMax = num(buyer.budget_max);
  const budgetMin = num(buyer.budget_min);

  if (price == null) {
    return {
      result: {
        key: "preco",
        label: "Preço",
        ok: false,
        detail: "Sem preço",
        score: 0,
        weight,
      },
      eliminate: false,
    };
  }
  if (budgetMax == null) {
    return {
      result: {
        key: "preco",
        label: "Preço",
        ok: true,
        detail: "Sem orçamento definido",
        score: Math.round(weight * 0.6),
        weight,
      },
      eliminate: false,
    };
  }

  const overshoot = (price - budgetMax) / budgetMax;
  let score = 0;
  let ok = false;
  let detail = "";

  if (overshoot <= 0) {
    score = weight;
    ok = true;
    detail = "Dentro do orçamento";
  } else if (overshoot <= PRICE_OVER_FULL) {
    score = Math.round(weight * 0.9);
    ok = true;
    detail = `Ligeiramente acima (+${Math.round(overshoot * 100)}%)`;
  } else if (overshoot <= PRICE_OVER_SOFT) {
    score = Math.round(weight * 0.55);
    ok = false;
    detail = `Acima do orçamento (+${Math.round(overshoot * 100)}%)`;
  } else if (overshoot <= PRICE_OVER_MAX) {
    score = Math.round(weight * 0.2);
    ok = false;
    detail = `Muito acima (+${Math.round(overshoot * 100)}%)`;
  } else {
    return {
      result: {
        key: "preco",
        label: "Preço",
        ok: false,
        detail: `Muito acima do orçamento (+${Math.round(overshoot * 100)}%)`,
        score: 0,
        weight,
      },
      eliminate: true,
    };
  }

  if (budgetMin != null && price < budgetMin * 0.7) {
    score = Math.min(score, Math.round(weight * 0.45));
    ok = false;
    detail = "Abaixo do intervalo pretendido";
  }

  return { result: { key: "preco", label: "Preço", ok, detail, score, weight }, eliminate: false };
}

function scoreTipologia(buyer: BuyerLike, property: PropertyLike): MatchCategoryResult {
  const weight = WEIGHTS.tipologia;
  const bt = normalizeLocation(buyer.tipologia);
  const pt = normalizeLocation(property.tipologia);
  const bQ = buyer.quartos_min ?? tipologiaQuartos(buyer.tipologia);
  const pQ = property.quartos ?? tipologiaQuartos(property.tipologia);

  // Sem preferência
  if (!bt && bQ == null) {
    return {
      key: "tipologia",
      label: "Tipologia",
      ok: true,
      detail: "Sem preferência",
      score: Math.round(weight * 0.7),
      weight,
    };
  }

  if (bt && pt && (bt === pt || bt.includes(pt) || pt.includes(bt))) {
    return {
      key: "tipologia",
      label: "Tipologia",
      ok: true,
      detail: `Tipologia ${property.tipologia}`,
      score: weight,
      weight,
    };
  }

  if (bQ != null && pQ != null) {
    const diff = pQ - bQ; // positivo = imóvel maior
    if (diff === 0)
      return {
        key: "tipologia",
        label: "Tipologia",
        ok: true,
        detail: `${property.tipologia ?? pQ + " quartos"}`,
        score: weight,
        weight,
      };
    if (diff === 1)
      // Ex.: comprador T3, imóvel T3+1/T4 → aceita como bónus
      return {
        key: "tipologia",
        label: "Tipologia",
        ok: true,
        detail: `${property.tipologia ?? pQ + " quartos"} (superior)`,
        score: Math.round(weight * 0.85),
        weight,
      };
    if (diff === -1)
      // Ex.: T3 pedido, imóvel T2+1 → parcial, com aviso
      return {
        key: "tipologia",
        label: "Tipologia",
        ok: false,
        detail: `${property.tipologia ?? pQ + " quartos"} (abaixo do pedido)`,
        score: Math.round(weight * 0.4),
        weight,
      };
    // Diferença ≥ 2 quartos → tratamento como incompatível (T0/T1/T5 vs T3)
    return {
      key: "tipologia",
      label: "Tipologia",
      ok: false,
      detail: `Tipologia incompatível (${property.tipologia ?? pQ + " q"})`,
      score: 0,
      weight,
    };
  }

  // Tipologia do imóvel desconhecida (N/D): não penalizar destrutivamente,
  // mas também não inflacionar.
  if (bt && !pt && pQ == null) {
    return {
      key: "tipologia",
      label: "Tipologia",
      ok: false,
      detail: "Tipologia N/D",
      score: Math.round(weight * 0.3),
      weight,
    };
  }

  return {
    key: "tipologia",
    label: "Tipologia",
    ok: false,
    detail: "Tipologia diferente",
    score: Math.round(weight * 0.25),
    weight,
  };
}

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
      score: Math.round(weight * 0.6),
      weight,
    };
  }
  if (pArea >= areaMin) {
    return {
      key: "area",
      label: "Área",
      ok: true,
      detail: `${pArea} m² (pedia ≥ ${areaMin})`,
      score: weight,
      weight,
    };
  }
  const ratio = pArea / areaMin;
  if (ratio >= 0.9)
    return {
      key: "area",
      label: "Área",
      ok: false,
      detail: `${pArea} m² (ligeiramente abaixo)`,
      score: Math.round(weight * 0.7),
      weight,
    };
  if (ratio >= 0.75)
    return {
      key: "area",
      label: "Área",
      ok: false,
      detail: `${pArea} m² abaixo do pretendido`,
      score: Math.round(weight * 0.35),
      weight,
    };
  return {
    key: "area",
    label: "Área",
    ok: false,
    detail: `${pArea} m² (muito abaixo)`,
    score: 0,
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
        // NÃO elimina — apenas penaliza ligeiramente
        s -= per * 0.5;
        parts.push(`sem ${label}`);
      }
    } else if (has === true) {
      s += per * 0.3; // pequeno bónus se o imóvel tem, mesmo sem ser pedido
      parts.push(label);
    }
  };

  applyReq(buyer.garagem_obrigatoria, property.garagem, "garagem");
  applyReq(buyer.elevador_obrigatorio, property.elevador, "elevador");
  if (property.jardim) {
    s += per * 0.3;
    parts.push("jardim");
  }
  if (property.piscina) {
    s += per * 0.3;
    parts.push("piscina");
  }

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

export function scoreMatch(buyer: BuyerLike, property: PropertyLike): MatchScore {
  // Gate 1: finalidade — venda vs arrendamento é sempre eliminatório.
  if (buyer.finalidade && property.finalidade && buyer.finalidade !== property.finalidade) {
    return { score: 0, compatible: false, categories: [], reasons: [] };
  }

  // Gate 2: tipo de imóvel — se o comprador listou tipos aceites e o imóvel
  // não está lá, é irrelevante (ex.: quer moradia, imóvel é garagem).
  const pTipo = normalizeLocation(property.tipo_imovel);
  const buyerTipos = (buyer.tipo_imovel ?? []).map(normalizeLocation).filter(Boolean);
  const tipoCategory: MatchCategoryResult | null =
    buyerTipos.length > 0 && pTipo
      ? {
          key: "tipo",
          label: "Tipo",
          ok: buyerTipos.includes(pTipo),
          detail: `Tipo ${property.tipo_imovel}`,
          score: 0,
          weight: 0,
        }
      : null;
  if (tipoCategory && !tipoCategory.ok) {
    return { score: 0, compatible: false, categories: [], reasons: [] };
  }
  // Se o comprador exige tipo mas o imóvel não o declara, também elimina
  // (evita apresentar imóveis sem tipo como se cumprissem o critério).
  if (buyerTipos.length > 0 && !pTipo) {
    return { score: 0, compatible: false, categories: [], reasons: [] };
  }

  const loc = scoreLocation(buyer, property);
  const preco = scorePreco(buyer, property);
  if (preco.eliminate) {
    return { score: 0, compatible: false, categories: [], reasons: [] };
  }
  const tip = scoreTipologia(buyer, property);
  // Gate 3: tipologia com diferença ≥ 2 quartos elimina — nunca apresentar
  // T0/T1/T5 a quem procura T3.
  const bQ = buyer.quartos_min ?? tipologiaQuartos(buyer.tipologia);
  const pQ = property.quartos ?? tipologiaQuartos(property.tipologia);
  if (bQ != null && pQ != null && Math.abs(pQ - bQ) >= 2) {
    return { score: 0, compatible: false, categories: [], reasons: [] };
  }
  // Gate 4: localização — se o comprador especificou zona e não há qualquer
  // ligação (nem match direto nem vizinhança até 3 hops), elimina.
  const buyerHasZona = tokens(buyer.zona).length > 0;
  if (buyerHasZona && loc.score === 0) {
    return { score: 0, compatible: false, categories: [], reasons: [] };
  }
  const area = scoreArea(buyer, property);
  const extras = scoreExtras(buyer, property);

  const categories: MatchCategoryResult[] = [loc, preco.result, tip, area, extras];
  if (tipoCategory) categories.unshift(tipoCategory);

  const total = loc.score + preco.result.score + tip.score + area.score + extras.score;
  const score = Math.max(0, Math.min(100, Math.round(total)));
  const reasons = categories.filter((c) => c.ok).map((c) => c.detail);

  return { score, compatible: score >= COMPAT_THRESHOLD, categories, reasons };
}