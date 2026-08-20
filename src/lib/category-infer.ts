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
};

const HABITACIONAL_RE = /(^|[^a-z0-9])t\s?([0-9]{1,2})([^0-9]|$)/i;
const ESTUDIO_RE = /\b(estudio|estúdio|studio|kitchenette|loft)\b/i;

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
    return { categorias: existentes, categoria_origem: "existente" };
  }

  // 2. Coluna/campo estruturado de tipo de imóvel.
  const fromTipo = resolveCategories(nonEmptyList(input.tipo_imovel));
  if (fromTipo.length > 0) {
    return { categorias: fromTipo, categoria_origem: "tipo_imovel" };
  }

  // 3. Tipologia habitacional é sinal forte de casas/apartamentos.
  const tipologia = typeof input.tipologia === "string" ? input.tipologia : "";
  if (tipologia && (HABITACIONAL_RE.test(tipologia) || ESTUDIO_RE.test(tipologia))) {
    return { categorias: ["casas_apartamentos"], categoria_origem: "tipologia" };
  }

  // 4. Palavras-chave no texto original / resumo.
  const blob = [input.texto_original ?? "", input.resumo ?? ""].join(" ").trim();
  const fromText = categoriesFromText(blob);
  if (fromText.length > 0) {
    return { categorias: fromText, categoria_origem: "inferido_texto" };
  }
  if (blob && (HABITACIONAL_RE.test(blob) || ESTUDIO_RE.test(blob))) {
    return { categorias: ["casas_apartamentos"], categoria_origem: "inferido_texto" };
  }

  // 5. Indecidível — o Motor deve falhar o filtro de tipo, não aceitar tudo.
  return { categorias: [], categoria_origem: "indecidivel" };
}

/** Aplica a inferência a um objeto `criteria`, devolvendo uma cópia enriquecida. */
export function withInferredCategories<T extends Record<string, unknown>>(
  criteria: T,
  texts: { texto_original?: string | null; resumo?: string | null } = {},
): T & { categorias: PropertyCategory[] | null; categoria_origem: CategoryOrigin } {
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
  };
}
