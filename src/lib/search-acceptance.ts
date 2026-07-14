// ---------------------------------------------------------------------------
// Search Acceptance — módulo neutro e ÚNICA fonte de verdade para decidir
// se uma procura (buyer/tenant search) extraída de qualquer canal (Excel,
// WhatsApp, extractAndMatch, futuros conectores/API/PDF) deve ser
// Aceite, Enviada para Revisão, ou Descartada como anúncio.
//
// REGRAS FUNDAMENTAIS
//  1. Nenhum canal pode replicar esta lógica. Todos importam este módulo.
//  2. O LLM NÃO decide aceitação — apenas estrutura/extrai dados. A
//     decisão vive aqui, é determinística e testável.
//  3. Combinações válidas: Compra+Comprador, Compra+Investidor,
//     Arrendamento+Inquilino. Incoerências vão para Revisão.
//  4. Casos ambíguos com dados estruturados suficientes → Aceite.
//  5. Casos ambíguos sem estrutura → Revisão.
//  6. Anúncios confirmados → Descartar.
// ---------------------------------------------------------------------------

export type Finalidade = "venda" | "arrendamento" | "indefinido";
export type BuyerTextClass = "procura" | "anuncio" | "ambiguo";
export type RoleSignal = "comprador" | "investidor" | "inquilino" | "senhorio" | null;

export type AcceptanceDecision = {
  kind: "aceite" | "revisao" | "anuncio";
  reason: string;
};

export type AcceptanceInput = {
  text: string | null;
  finalidade: Finalidade;
  hasStructured: boolean;
};

// Classifica um texto como procura (compra ou arrendamento), oferta/anúncio,
// ou ambíguo. Casos sem texto livre mas com dados estruturados válidos são
// tratados no wrapper `evaluateSearchAcceptance` — não aqui.
export function classifyBuyerText(text: string | null): BuyerTextClass {
  if (!text) return "ambiguo";
  const t = text.toLowerCase();
  const procuraSignals = [
    /procur[oa]\b/, /procura(m|)\s+(por\s+)?[a-z]/,
    /(tenho|temos)\s+(cliente|comprador|casal|fam[ií]lia)/,
    /cliente\s+(aprovad|pretende|interess|procura|com\s+cr[eé]dito)/,
    /pretende\s+(comprar|arrendar|adquirir)/, /necessit[ao]/, /arrendat[aá]rio/,
    /interessad[oa]s?\s+em\s+(comprar|arrendar)/,
    /aprovad[oa]\s+para\s+cr[eé]dito/, /or[cç]amento\s+at[eé]/,
    /compra\s+urgente/, /precisa[m]?\s+de\s+(casa|apartamento|moradia)/,
    /inquilin[oa]\s+(procura|pretende|para)/,
  ];
  const hasProcura = procuraSignals.some((re) => re.test(t));
  const ofertaSignals = [
    /vende[- ]se/, /\bvendo\b/, /para\s+venda/, /arrenda[- ]se/, /para\s+arrendament/,
    /oportunidade\s+[uú]nica/, /novo\s+no\s+mercado/, /km\s*0/,
    /pre[cç]o\s+reduzid/, /an[uú]ncio/, /vis(ite|ita\s+virtual)/,
    /agende\s+visita/, /marque\s+visita/, /studio\s+novo/,
    /vista\s+(mar|rio)/, /inclui\s+garagem/, /remodelad[oa]\s+t[0-6]/,
    /\d+\s*€\s*\/\s*m[²2]/, /apresenta[cç][aã]o\s+de\s+(im[oó]vel|apartamento|moradia)/,
  ];
  const hasOferta = ofertaSignals.some((re) => re.test(t));
  const hasPrice = /\d[\d.\s]{2,}\s*(€|eur)/.test(t);
  const hasArea = /\d+\s*m[²2]/.test(t);
  const hasTipologia = /\bt[0-6]\b/.test(t);
  const structuralAd = hasPrice && hasArea && hasTipologia && !hasProcura;

  if (hasProcura && !hasOferta) return "procura";
  if (hasOferta || structuralAd) return "anuncio";
  return "ambiguo";
}

// Detecta o papel implícito no texto: quem é que está a agir. Usado para
// diagnosticar incoerência com a finalidade estruturada.
export function detectRoleSignal(text: string | null): RoleSignal {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/procuro\s+inquilin|tenho\s+.*\bpara\s+arrendar|disponibiliz[oa]\s+.*arrend|senhori[oa]/.test(t))
    return "senhorio";
  if (/investidor|projet[oa]s?\s+aprovad|empreendimento|>\s*\d+\s*fra[cç]/.test(t))
    return "investidor";
  if (/inquilin[oa]\s+(procura|pretende|para)|arrendat[aá]ri[oa]|pretende\s+arrendar|procur[oa]\s+.*(arrend|renda|aluguer)/.test(t))
    return "inquilino";
  if (/tenho\s+comprador|cliente\s+(aprovad|pretende\s+comprar)|pretende\s+comprar|procur[oa]\s+.*(comprar|para\s+compra)|compra\s+urgente/.test(t))
    return "comprador";
  return null;
}

// Heurística universal de "dados estruturados suficientes". Um canal deve
// preferir chamar `hasStructuredCriteria` do que reimplementar a regra.
// Regra: finalidade definida + zona (ou concelho/freguesia) + (tipologia OU
// tipo de imóvel) + pelo menos um sinal de orçamento (min ou max) OU área.
export function hasStructuredCriteria(input: {
  finalidade: Finalidade;
  tipologia?: string | null;
  tipo_imovel?: string[] | string | null;
  zona?: string | null;
  freguesia?: string | null;
  concelho?: string | null;
  municipio?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  area_min?: number | null;
}): boolean {
  if (input.finalidade === "indefinido") return false;
  const zone = input.zona ?? input.concelho ?? input.municipio ?? input.freguesia;
  if (!zone) return false;
  const tipo =
    input.tipologia ||
    (Array.isArray(input.tipo_imovel) ? input.tipo_imovel.length > 0 : !!input.tipo_imovel);
  if (!tipo) return false;
  const money = input.budget_max != null || input.budget_min != null || input.area_min != null;
  return !!money;
}

// Decisor único. Determinístico. Todos os canais chamam esta função.
export function evaluateSearchAcceptance(input: AcceptanceInput): AcceptanceDecision {
  const cls = classifyBuyerText(input.text);
  if (cls === "anuncio") {
    return { kind: "anuncio", reason: "Texto parece anúncio, não procura" };
  }
  const role = detectRoleSignal(input.text);
  if (input.finalidade === "venda" && (role === "inquilino" || role === "senhorio")) {
    return {
      kind: "revisao",
      reason: "Finalidade Compra incoerente com o texto — rever manualmente",
    };
  }
  if (input.finalidade === "arrendamento" && role === "senhorio") {
    return {
      kind: "revisao",
      reason: "Finalidade Arrendamento incoerente com o texto (senhorio) — rever manualmente",
    };
  }
  if (cls === "procura") {
    return { kind: "aceite", reason: "Procura reconhecida" };
  }
  if (input.hasStructured) {
    return { kind: "aceite", reason: "Dados estruturados suficientes" };
  }
  return {
    kind: "revisao",
    reason: "Procura ambígua e dados insuficientes — rever manualmente",
  };
}