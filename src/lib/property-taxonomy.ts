/**
 * Item 5 — Taxonomia única de "Tipo de imóvel" (fonte de verdade).
 *
 * Existem duas convenções em circulação: procuras vindas da IA usam CamelCase
 * ("Apartamento", "Espaço comercial") e imóveis usam minúsculas. Este módulo
 * normaliza ambas para uma **categoria de topo** e um **subtipo**, para que o
 * Motor de Match compare categorias em vez de texto livre.
 */

export type PropertyCategory =
  | "casas_apartamentos"
  | "predios"
  | "escritorios"
  | "comercial_armazens"
  | "trespasses"
  | "terrenos"
  | "herdades_quintas";

export const CATEGORY_LABELS: Record<PropertyCategory, string> = {
  casas_apartamentos: "Casas e Apartamentos",
  predios: "Prédios",
  escritorios: "Escritórios",
  comercial_armazens: "Comercial e Armazéns",
  trespasses: "Trespasses",
  terrenos: "Terrenos",
  herdades_quintas: "Herdades e Quintas",
};

/** Subtipos por categoria (ordem de apresentação na UI). */
export const CATEGORY_SUBTYPES: Record<PropertyCategory, string[]> = {
  casas_apartamentos: ["Apartamento", "Moradia", "Duplex", "Penthouse", "Estúdio"],
  predios: ["Prédio", "Prédio de rendimento", "Bloco de apartamentos"],
  escritorios: ["Escritório", "Consultório", "Coworking"],
  comercial_armazens: ["Loja", "Espaço comercial", "Armazém", "Indústria", "Garagem"],
  trespasses: ["Trespasse", "Restaurante", "Café", "Hotel", "Lar de idosos", "Alojamento local"],
  terrenos: ["Terreno urbano", "Terreno rústico", "Lote"],
  herdades_quintas: ["Herdade", "Quinta", "Monte alentejano", "Casa de campo"],
};

function norm(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Sinónimos → categoria. Chaves já normalizadas (sem acentos, minúsculas). */
const SYNONYMS: Array<[RegExp, PropertyCategory]> = [
  [/\b(apartamento|apartamentos|andar|flat|t[0-9]|moradia|casa|villa|duplex|penthouse|estudio|studio|kitchenette)\b/, "casas_apartamentos"],
  [/\b(predio|predios|edificio|bloco de apartamentos|predio de rendimento)\b/, "predios"],
  [/\b(escritorio|escritorios|office|consultorio|coworking)\b/, "escritorios"],
  [/\b(loja|lojas|espaco comercial|comercio|comercial|armazem|armazens|industria|industrial|pavilhao|garagem|estacionamento)\b/, "comercial_armazens"],
  [/\b(trespasse|trespasses|restaurante|snack|cafe|padaria|hotel|hostel|lar de idosos|lar|residencia senior|alojamento local|al)\b/, "trespasses"],
  [/\b(terreno|terrenos|lote|lotes|rustico|urbano para construcao)\b/, "terrenos"],
  [/\b(herdade|herdades|quinta|quintas|monte alentejano|casa de campo|agricola|olival|vinha)\b/, "herdades_quintas"],
];

const CATEGORY_KEYS = new Set<string>(Object.keys(CATEGORY_LABELS));

/**
 * Resolve texto livre (ou o próprio identificador de categoria) para categoria
 * de topo. `null` quando não é possível decidir — nesse caso o Motor não deve
 * rejeitar por categoria.
 */
export function resolveCategory(value: unknown): PropertyCategory | null {
  if (typeof value === "string" && CATEGORY_KEYS.has(value)) return value as PropertyCategory;
  const n = norm(value);
  if (!n) return null;
  for (const [re, cat] of SYNONYMS) if (re.test(n)) return cat;
  return null;
}

/** Resolve uma lista (procuras têm múltiplos tipos) para categorias únicas. */
export function resolveCategories(values: unknown): PropertyCategory[] {
  const arr = Array.isArray(values) ? values : values == null ? [] : [values];
  const out: PropertyCategory[] = [];
  for (const v of arr) {
    const c = resolveCategory(v);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

export function categoryLabel(c: PropertyCategory | null): string {
  return c ? CATEGORY_LABELS[c] : "—";
}

// ---------------------------------------------------------------------------
// Estado do imóvel (usado no orçamento condicional)
// ---------------------------------------------------------------------------

export type PropertyCondition = "novo" | "bom" | "recuperar";

const CONDITION_PATTERNS: Array<[RegExp, PropertyCondition]> = [
  [/\b(para recuperar|a recuperar|para reabilitar|reabilitar|para obras|precisa de obras|necessita de obras|ruina|para restaurar|para remodelar)\b/, "recuperar"],
  [/\b(novo|nova construcao|construcao nova|em construcao|pronto a habitar|chave na mao|remodelado|renovado|totalmente restaurado)\b/, "novo"],
];

/** Infere o estado a partir de texto (descrição/características). */
export function inferCondition(...texts: Array<string | null | undefined>): PropertyCondition | null {
  const blob = norm(texts.filter(Boolean).join(" "));
  if (!blob) return null;
  for (const [re, cond] of CONDITION_PATTERNS) if (re.test(blob)) return cond;
  return null;
}

export function normalizeCondition(v: unknown): PropertyCondition | null {
  const n = norm(v);
  if (n === "novo" || n === "bom" || n === "recuperar") return n;
  return inferCondition(typeof v === "string" ? v : null);
}
