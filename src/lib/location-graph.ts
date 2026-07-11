// Grafo geográfico do Property Match — Release 1.2.1.
//
// Filosofia: **respeitar a granularidade que o comprador declarou**.
//   - Comprador pediu um CONCELHO → só imóveis desse concelho contam.
//   - Comprador pediu uma FREGUESIA → só imóveis da mesma freguesia ou de
//     freguesias limítrofes configuradas em ADJACENT contam. Concelho igual
//     mas freguesia diferente NÃO é compatibilidade automática.
//
// Isto elimina o falso positivo clássico "buyer procura Benfica, aparece
// Estrela porque é o mesmo concelho de Lisboa".

export function normalizeLocation(v: string | null | undefined): string {
  return (v ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Concelhos conhecidos — quando o campo `zona` da procura for um destes,
// o motor entende que o comprador aceita QUALQUER freguesia dentro do
// concelho. Editável sem tocar em código.
const KNOWN_CONCELHOS: string[] = [
  // Área Metropolitana de Lisboa
  "lisboa", "cascais", "oeiras", "sintra", "mafra", "loures", "odivelas",
  "amadora", "vila franca de xira", "azambuja",
  // Península de Setúbal
  "almada", "seixal", "barreiro", "moita", "montijo", "alcochete",
  "sesimbra", "setubal", "palmela",
  // Oeste
  "torres vedras", "lourinha", "peniche", "caldas da rainha", "obidos",
  "alcobaca", "nazare",
  // Grande Porto (para futuro)
  "porto", "matosinhos", "vila nova de gaia", "gondomar", "maia",
  "valongo", "vila do conde", "povoa de varzim",
];
const CONCELHOS_SET = new Set(KNOWN_CONCELHOS.map(normalizeLocation));

export function isKnownConcelho(v: string | null | undefined): boolean {
  return CONCELHOS_SET.has(normalizeLocation(v));
}

// Freguesias limítrofes — só freguesias reconhecidas nesta matriz são
// tratadas como "mercado próximo aceitável". Bidirecional.
const ADJACENT: Record<string, string[]> = {
  // --- Lisboa (freguesias) ---
  benfica: ["sao domingos de benfica"],
  "sao domingos de benfica": ["benfica", "carnide", "campolide"],
  carnide: ["sao domingos de benfica", "lumiar"],
  lumiar: ["carnide", "santa clara", "alvalade"],
  "santa clara": ["lumiar", "olivais"],
  alvalade: ["lumiar", "areeiro", "avenidas novas"],
  areeiro: ["alvalade", "penha de franca", "arroios"],
  "avenidas novas": ["alvalade", "arroios", "campolide"],
  arroios: ["areeiro", "avenidas novas", "santo antonio", "penha de franca"],
  "santo antonio": ["arroios", "avenidas novas", "santa maria maior"],
  "penha de franca": ["arroios", "areeiro", "sao vicente", "beato"],
  "sao vicente": ["penha de franca", "santa maria maior", "beato"],
  "santa maria maior": ["santo antonio", "sao vicente", "misericordia"],
  misericordia: ["santa maria maior", "estrela"],
  estrela: ["misericordia", "campo de ourique", "lapa"],
  lapa: ["estrela"],
  "campo de ourique": ["estrela", "campolide"],
  campolide: ["campo de ourique", "avenidas novas", "sao domingos de benfica"],
  ajuda: ["belem", "alcantara"],
  belem: ["ajuda", "alcantara"],
  alcantara: ["belem", "ajuda", "campo de ourique"],
  beato: ["sao vicente", "penha de franca", "marvila"],
  marvila: ["beato", "olivais"],
  olivais: ["marvila", "santa clara", "parque das nacoes"],
  "parque das nacoes": ["olivais"],

  // --- Cascais (freguesias) ---
  cascais: ["estoril", "sao domingos de rana"],
  "cascais e estoril": ["sao domingos de rana", "alcabideche"],
  estoril: ["cascais", "alcabideche"],
  alcabideche: ["estoril", "sao domingos de rana"],
  "sao domingos de rana": ["cascais", "alcabideche", "carcavelos"],
  carcavelos: ["sao domingos de rana", "parede"],
  parede: ["carcavelos"],
  "carcavelos e parede": ["sao domingos de rana"],

  // --- Oeiras (freguesias) ---
  oeiras: ["porto salvo", "algés", "alges"],
  "porto salvo": ["oeiras", "barcarena"],
  barcarena: ["porto salvo"],
  "algés": ["oeiras", "alges"],
  alges: ["oeiras"],
  "carnaxide e queijas": ["porto salvo", "alges"],
  "oeiras e sao juliao da barra": ["porto salvo", "carnaxide e queijas"],

  // --- Sintra (freguesias) ---
  sintra: ["colares", "sao pedro de penaferrim", "santa maria e sao miguel"],
  "santa maria e sao miguel": ["sintra"],
  colares: ["sintra"],
  agualva: ["cacem", "mira sintra"],
  cacem: ["agualva", "mira sintra"],
  "mira sintra": ["agualva", "cacem"],
  "algueirao mem martins": ["rio de mouro"],
  "rio de mouro": ["algueirao mem martins", "cacem"],
  queluz: ["belas", "massama"],
  belas: ["queluz"],
  massama: ["queluz", "monte abraao"],
  "monte abraao": ["massama"],

  // --- Setúbal / Península de Setúbal ---
  setubal: ["sao sebastiao"],
  "sao sebastiao": ["setubal"],
  seixal: ["arrentela", "amora"],
  arrentela: ["seixal", "amora", "corroios"],
  amora: ["seixal", "arrentela"],
  corroios: ["arrentela"],
  almada: ["cova da piedade", "cacilhas", "pragal"],
  "cova da piedade": ["almada", "pragal"],
  cacilhas: ["almada"],
  pragal: ["almada", "cova da piedade"],
  costa: ["caparica"],
  caparica: ["costa", "trafaria"],
  trafaria: ["caparica"],
  montijo: ["afonsoeiro", "atalaia", "sarilhos grandes", "canha"],
  alcochete: ["samouco", "sao francisco", "passil"],
  "sao francisco": ["alcochete", "samouco"],
  samouco: ["alcochete", "sao francisco"],
  moita: ["baixa da banheira", "alhos vedros"],
  "baixa da banheira": ["moita", "alhos vedros"],
  "alhos vedros": ["moita", "baixa da banheira"],
};

function buildBiMap(src: Record<string, string[]>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!m.has(a)) m.set(a, new Set());
    m.get(a)!.add(b);
  };
  for (const [k, vs] of Object.entries(src)) {
    const nk = normalizeLocation(k);
    for (const v of vs) {
      const nv = normalizeLocation(v);
      add(nk, nv);
      add(nv, nk);
    }
  }
  return m;
}

const ADJACENT_MAP = buildBiMap(ADJACENT);

/**
 * Freguesias reconhecidas como administrativas — todas as chaves do grafo
 * de adjacências. Usado por `resolveZone` para distinguir freguesias
 * conhecidas de expressões novas.
 */
export function isKnownFreguesia(v: string | null | undefined): boolean {
  return ADJACENT_MAP.has(normalizeLocation(v));
}

export function areFreguesiasAdjacent(a: string, b: string): boolean {
  const na = normalizeLocation(a);
  const nb = normalizeLocation(b);
  if (!na || !nb) return false;
  return ADJACENT_MAP.get(na)?.has(nb) ?? false;
}

/**
 * Nível de proximidade entre duas localidades normalizadas.
 * Kept for backwards compatibility. Retorna 1 se igual, 2 se adjacente,
 * null caso contrário. Nível 3 foi removido em 1.2.1.
 */
export function locationLevel(a: string, b: string): 1 | 2 | null {
  const na = normalizeLocation(a);
  const nb = normalizeLocation(b);
  if (!na || !nb) return null;
  if (na === nb) return 1;
  if (ADJACENT_MAP.get(na)?.has(nb)) return 2;
  return null;
}