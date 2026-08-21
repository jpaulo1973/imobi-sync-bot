/**
 * Release 1.3.1 — Inferência determinística de categoria para IMÓVEIS.
 *
 * Espelho de `category-infer.ts` (que serve as procuras), mas orientado à
 * tabela `properties`. Objetivo: nenhum imóvel entra no Motor Match sem uma
 * decisão explícita de categoria, porque um imóvel sem categoria cruzava com
 * procuras de qualquer categoria (fail-open).
 *
 * Ordem de decisão (para na primeira que resolve):
 *  1. `categoria` já preenchida        -> "existente" (NUNCA sobrepor)
 *  2. `subtipo_imovel` / `tipo_imovel` -> "tipo_imovel"
 *  3. `tipologia` T0..T20 / estúdio    -> "tipologia" (casas_apartamentos)
 *  4. texto (título/descrição/caract.) -> "inferido_texto" (só se 1 categoria)
 *  5. nada resolve                     -> "indecidivel" (categoria null)
 *
 * Não faz I/O — módulo puro, testável.
 */

import { categoriesFromText } from "./category-infer";
import { resolveCategory, type PropertyCategory } from "./property-taxonomy";

export type PropertyCategoryOrigin =
  | "existente"
  | "tipo_imovel"
  | "tipologia"
  | "inferido_texto"
  | "indecidivel";

export type PropertyCategoryInferInput = {
  categoria?: unknown;
  tipo_imovel?: unknown;
  subtipo_imovel?: unknown;
  tipologia?: unknown;
  referencia?: unknown;
  titulo?: unknown;
  descricao?: unknown;
  caracteristicas?: unknown;
};

export type PropertyCategoryInferResult = {
  categoria: PropertyCategory | null;
  origem: PropertyCategoryOrigin;
  /** Todas as categorias detetadas no texto (auditoria / deteção de ambiguidade). */
  sinais: PropertyCategory[];
};

const HABITACIONAL_RE = /(^|[^a-z0-9])t\s?([0-9]{1,2})([^0-9]|$)/i;
const ESTUDIO_RE = /\b(estudio|estúdio|studio|kitchenette|loft)\b/i;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function inferPropertyCategory(
  input: PropertyCategoryInferInput,
): PropertyCategoryInferResult {
  // 1. Nunca sobrepor uma categoria já decidida.
  const existente = resolveCategory(input.categoria);
  if (existente) return { categoria: existente, origem: "existente", sinais: [existente] };

  // 2. Campos estruturados de tipo (subtipo é mais específico).
  const fromTipo = resolveCategory(input.subtipo_imovel) ?? resolveCategory(input.tipo_imovel);
  if (fromTipo) return { categoria: fromTipo, origem: "tipo_imovel", sinais: [fromTipo] };

  // 3. Tipologia. Em imóveis importados a tipologia guarda por vezes o próprio
  //    tipo ("Moradia"), por isso tenta-se primeiro a taxonomia e só depois o
  //    padrão habitacional T0..T20 / estúdio.
  const tipologia = str(input.tipologia);
  const fromTipologia = resolveCategory(input.tipologia);
  if (fromTipologia) return { categoria: fromTipologia, origem: "tipologia", sinais: [fromTipologia] };
  if (tipologia && (HABITACIONAL_RE.test(tipologia) || ESTUDIO_RE.test(tipologia))) {
    return { categoria: "casas_apartamentos", origem: "tipologia", sinais: ["casas_apartamentos"] };
  }

  // 4. Texto livre. `categoriesFromText` já remove características que não são
  //    tipo de imóvel ("lugar de garagem"), evitando falsos comerciais.
  const blob = stripAccents(
    [str(input.titulo), str(input.descricao), str(input.caracteristicas)].join(" ").trim(),
  );
  const sinais = blob ? categoriesFromText(blob) : [];
  if (sinais.length === 1) {
    return { categoria: sinais[0], origem: "inferido_texto", sinais };
  }
  if (sinais.length === 0 && blob && (HABITACIONAL_RE.test(blob) || ESTUDIO_RE.test(blob))) {
    return { categoria: "casas_apartamentos", origem: "inferido_texto", sinais: ["casas_apartamentos"] };
  }

  // 5. Ambíguo (>= 2 sinais) ou sem qualquer sinal: decisão manual.
  return { categoria: null, origem: "indecidivel", sinais };
}
