// Matriz de compatibilidade geográfica do Property Match.
//
// Três níveis de proximidade, facilmente editáveis sem tocar em código de
// scoring:
//   Nível 1 — mesma localidade (match exato ou freguesia dentro do concelho).
//   Nível 2 — mercados naturalmente relacionados (aparecem sempre).
//   Nível 3 — mercados próximos mas distintos (só se `expandSearch` estiver
//             ligado ou não houver resultados de nível 1/2).
//
// Para acrescentar zonas, basta editar LEVEL2 / LEVEL3 abaixo — o resto do
// motor lê a matriz automaticamente e trata a bidirecionalidade.

export function normalizeLocation(v: string | null | undefined): string {
  return (v ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Mercados naturalmente relacionados — aparecem sempre nos resultados.
const LEVEL2: Record<string, string[]> = {
  montijo: ["alcochete", "samouco", "afonsoeiro", "atalaia", "sarilhos grandes", "canha"],
  alcochete: ["montijo", "samouco", "sao francisco", "passil"],
  "sao francisco": ["alcochete", "samouco"],
  samouco: ["alcochete", "sao francisco", "montijo"],
  passil: ["alcochete", "atalaia"],
  atalaia: ["montijo", "passil"],
  afonsoeiro: ["montijo"],
  "sarilhos grandes": ["montijo"],
  canha: ["montijo"],
  moita: ["baixa da banheira", "alhos vedros", "sarilhos pequenos"],
  "baixa da banheira": ["moita", "alhos vedros"],
  "alhos vedros": ["moita", "baixa da banheira"],
};

// Mercados próximos mas distintos — só aparecem com pesquisa alargada.
const LEVEL3: Record<string, string[]> = {
  montijo: ["barreiro", "moita", "pinhal novo", "quinta do conde", "palmela"],
  alcochete: ["barreiro", "moita", "pinhal novo"],
  moita: ["montijo", "barreiro", "palmela", "pinhal novo"],
  barreiro: ["montijo", "alcochete", "moita", "seixal"],
  "pinhal novo": ["montijo", "palmela", "quinta do conde"],
  "quinta do conde": ["montijo", "pinhal novo", "sesimbra"],
  palmela: ["montijo", "pinhal novo", "moita"],
};

function buildBiMap(src: Record<string, string[]>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!m.has(a)) m.set(a, new Set());
    m.get(a)!.add(b);
  };
  for (const [k, vs] of Object.entries(src)) for (const v of vs) { add(k, v); add(v, k); }
  return m;
}

const LEVEL2_MAP = buildBiMap(LEVEL2);
const LEVEL3_MAP = buildBiMap(LEVEL3);

/**
 * Nível de proximidade entre duas localidades normalizadas.
 * 1 = mesma localidade, 2 = naturalmente relacionada, 3 = próxima mas distinta,
 * null = incompatível (não apresentar automaticamente).
 */
export function locationLevel(a: string, b: string): 1 | 2 | 3 | null {
  if (!a || !b) return null;
  if (a === b) return 1;
  if (LEVEL2_MAP.get(a)?.has(b)) return 2;
  if (LEVEL3_MAP.get(a)?.has(b)) return 3;
  return null;
}