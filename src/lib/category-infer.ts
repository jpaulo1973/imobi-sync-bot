/**
 * Release 1.2.12 — Inferência determinística de categoria de procura.
 *
 * Objetivo: nenhuma procura entra no Motor Match sem uma decisão explícita
 * sobre a categoria de imóvel. A decisão é sempre determinística (sem LLM) e
 * auditável através de `categoria_origem`.
 *
 * Ordem de decisão (para na primeira que resolve):
 *  1. `categorias` já existentes  -> "existente"   (NUNCA sobrepor)
 *  2. `tipo_imovel`               -> "tipo_imovel"
 *  3. `tipologia` (T0..T9/estúdio)-> "tipologia"
 *  4. palavras-chave no texto     -> "inferido_texto"
 *  5. nada resolve                -> "indecidivel" (categorias: [])
 *
 * Release 1.2.13 — Multi-uso: antes de aceitar 2/3/4, corre `detectMultiUse`,
 * que recolhe TODOS os sinais (tipo_imovel + tipologia + texto) em paralelo.
 * Se sobrarem >= 2 categorias distintas depois da supressão de falsos
 * multi-uso ("terreno para moradia"), a procura fica `indecidivel` com
 * `motivo_indecidivel: "multi_uso"` e é resolvida à mão na aba Revisão.
 */

import { resolveCategories, resolveCategory, type PropertyCategory } from "./property-taxonomy";

export type CategoryOrigin =
  | "existente"
  | "tipo_imovel"
  | "tipologia"
  | "inferido_texto"
  | "indecidivel";

export type CategoryInferInput = {
  categorias?: unknown;
  tipo_imovel?: unknown;
  tipologia?: unknown;
  texto_original?: string | null;
  resumo?: string | null;
};

export type CategoryInferResult = {
  categorias: PropertyCategory[];
  categoria_origem: CategoryOrigin;
  multi_uso: boolean;
  sinais: PropertyCategory[];
  motivo_indecidivel: IndecidivelReason;
};

export type IndecidivelReason = "multi_uso" | "sem_sinal" | null;

const HABITACIONAL_RE = /(^|[^a-z0-9])t\s?([0-9]{1,2})([^0-9]|$)/i;
const ESTUDIO_RE = /\b(estudio|estúdio|studio|kitchenette|loft)\b/i;

/**
 * Falsos multi-uso: expressões de FINALIDADE onde o segundo uso não é um
 * segundo tipo procurado. Substituem-se pelo uso real antes de extrair sinais.
 */
const FALSE_MULTI_PATTERNS: Array<[RegExp, string]> = [
  // "terreno para construção de moradia", "lote com viabilidade para apartamentos"
  [/\b(terrenos?|lotes?)\b[^,.;\n]*?\b(para|destinad[oa]s?\s+a|com\s+viabilidade|com\s+projeto)\b[^,.;\n]*/gi, " terreno "],
  // "prédio para AL", "loja para investimento" (finalidade, não segundo tipo)
  [/\b(predios?|prédios?|edificios?|edifícios?|lojas?|armazens?|armazéns?|apartamentos?|moradias?|quintas?|herdades?)\b\s+para\s+(al|alojamento\s+local|hostel|investimento|rentabilidade|rendimento)\b/gi, " $1 "],
];

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Remove expressões de finalidade que criam multi-uso artificial. */
export function suppressFalseMultiUse(text: string): string {
  let out = text;
  for (const [re, rep] of FALSE_MULTI_PATTERNS) out = out.replace(re, rep);
  return out;
}

function nonEmptyList(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : value == null ? [] : [value];
  return arr.filter((v) => typeof v === "string" && v.trim().length > 0) as string[];
}

/** Extrai categorias de um texto livre, palavra a palavra (determinístico). */
export function categoriesFromText(text: string | null | undefined): PropertyCategory[] {
  if (!text) return [];
  const out: PropertyCategory[] = [];
  // Percorre tokens/expressões: resolveCategory já faz normalização e regex.
  const tokens = text.split(/[\n,;.!?()/|]+|\s{2,}/g);
  for (const chunk of [...tokens, text]) {
    const c = resolveCategory(chunk);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

export function inferSearchCategories(input: CategoryInferInput): CategoryInferResult {
  // 1. Nunca sobrepor valor já existente.
  const existentes = resolveCategories(nonEmptyList(input.categorias));
  if (existentes.length > 0) {
    return {
      categorias: existentes,
      categoria_origem: "existente",
      multi_uso: false,
      sinais: existentes,
      motivo_indecidivel: null,
    };
  }

  // 1b. Multi-uso -> nunca decidir automaticamente; vai para Revisão manual.
  const multi = detectMultiUse(input);
  if (multi.multi_uso) {
    return {
      categorias: [],
      categoria_origem: "indecidivel",
      multi_uso: true,
      sinais: multi.sinais,
      motivo_indecidivel: "multi_uso",
    };
  }

  // 2. Coluna/campo estruturado de tipo de imóvel.
  const fromTipo = resolveCategories(nonEmptyList(input.tipo_imovel));
  if (fromTipo.length > 0) {
    return { categorias: fromTipo, categoria_origem: "tipo_imovel", multi_uso: false, sinais: multi.sinais, motivo_indecidivel: null };
  }

  // 3. Tipologia habitacional é sinal forte de casas/apartamentos.
  const tipologia = typeof input.tipologia === "string" ? input.tipologia : "";
  if (tipologia && (HABITACIONAL_RE.test(tipologia) || ESTUDIO_RE.test(tipologia))) {
    return { categorias: ["casas_apartamentos"], categoria_origem: "tipologia", multi_uso: false, sinais: multi.sinais, motivo_indecidivel: null };
  }

  // 4. Palavras-chave no texto original / resumo.
  const blob = [input.texto_original ?? "", input.resumo ?? ""].join(" ").trim();
  const fromText = categoriesFromText(suppressFalseMultiUse(stripAccents(blob)));
  if (fromText.length > 0) {
    return { categorias: fromText, categoria_origem: "inferido_texto", multi_uso: false, sinais: multi.sinais, motivo_indecidivel: null };
  }
  if (blob && (HABITACIONAL_RE.test(blob) || ESTUDIO_RE.test(blob))) {
    return { categorias: ["casas_apartamentos"], categoria_origem: "inferido_texto", multi_uso: false, sinais: multi.sinais, motivo_indecidivel: null };
  }

  // 5. Indecidível — o Motor deve falhar o filtro de tipo, não aceitar tudo.
  return {
    categorias: [],
    categoria_origem: "indecidivel",
    multi_uso: false,
    sinais: multi.sinais,
    motivo_indecidivel: "sem_sinal",
  };
}

/**
 * Deteção robusta e reutilizável de procuras multi-uso: recolhe todos os sinais
 * (tipo_imovel, tipologia, texto) sem parar no primeiro sucesso.
 */
export function detectMultiUse(input: CategoryInferInput): {
  multi_uso: boolean;
  sinais: PropertyCategory[];
} {
  const sinais: PropertyCategory[] = [];
  const push = (list: PropertyCategory[]) => {
    for (const c of list) if (!sinais.includes(c)) sinais.push(c);
  };

  push(resolveCategories(nonEmptyList(input.tipo_imovel)));

  const tipologia = typeof input.tipologia === "string" ? input.tipologia : "";
  if (tipologia && (HABITACIONAL_RE.test(tipologia) || ESTUDIO_RE.test(tipologia))) {
    push(["casas_apartamentos"]);
  }

  const blob = [input.texto_original ?? "", input.resumo ?? ""].join(" ").trim();
  if (blob) {
    const clean = suppressFalseMultiUse(stripAccents(blob));
    push(categoriesFromText(clean));
    if (HABITACIONAL_RE.test(clean)) push(["casas_apartamentos"]);
  }

  return { multi_uso: sinais.length >= 2, sinais };
}

/** Aplica a inferência a um objeto `criteria`, devolvendo uma cópia enriquecida. */
export function withInferredCategories<T extends Record<string, unknown>>(
  criteria: T,
  texts: { texto_original?: string | null; resumo?: string | null } = {},
): T & {
  categorias: PropertyCategory[] | null;
  categoria_origem: CategoryOrigin;
  motivo_indecidivel: IndecidivelReason;
} {
  const res = inferSearchCategories({
    categorias: (criteria as any).categorias,
    tipo_imovel: (criteria as any).tipo_imovel,
    tipologia: (criteria as any).tipologia,
    texto_original: texts.texto_original ?? null,
    resumo: texts.resumo ?? (criteria as any).resumo ?? null,
  });
  return {
    ...criteria,
    categorias: res.categorias.length > 0 ? res.categorias : null,
    categoria_origem: res.categoria_origem,
    motivo_indecidivel: res.motivo_indecidivel,
  };
}
