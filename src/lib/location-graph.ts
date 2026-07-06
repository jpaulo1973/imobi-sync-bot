// Grafo de zonas vizinhas para o Property Match.
// Estrutura simples: nome normalizado → lista de nomes vizinhos normalizados.
// Facilmente expansível: basta acrescentar entradas (simétricas).
//
// A normalização remove acentos, passa a lowercase e faz trim, para que
// "São Francisco", "sao francisco" e "SÃO FRANCISCO" sejam o mesmo nó.

export function normalizeLocation(v: string | null | undefined): string {
  return (v ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Adjacência bidirecional. Adiciona novos concelhos/freguesias aqui.
// Regra prática: liga vizinhas geográficas diretas — o BFS trata as ligações
// indiretas com custo de "hops".
const RAW_NEIGHBORS: Record<string, string[]> = {
  // Península de Setúbal — exemplo pedido no briefing
  alcochete: ["sao francisco", "samouco", "passil", "montijo"],
  "sao francisco": ["alcochete", "samouco"],
  samouco: ["alcochete", "sao francisco", "passil"],
  passil: ["alcochete", "samouco", "atalaia"],
  atalaia: ["passil", "montijo"],
  montijo: ["atalaia", "alcochete", "moita", "canha"],
  moita: ["montijo", "baixa da banheira", "alhos vedros"],
  "baixa da banheira": ["moita", "alhos vedros"],
  "alhos vedros": ["moita", "baixa da banheira"],
  canha: ["montijo"],
};

// Constrói o mapa final garantindo bidirecionalidade — evita bugs de omissão.
const NEIGHBORS: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!m.has(a)) m.set(a, new Set());
    m.get(a)!.add(b);
  };
  for (const [k, vs] of Object.entries(RAW_NEIGHBORS)) {
    for (const v of vs) {
      add(k, v);
      add(v, k);
    }
  }
  return m;
})();

/**
 * Distância em "hops" entre dois nós do grafo. 0 = mesmo nó.
 * Devolve Infinity se não houver caminho até `maxHops` (default 3).
 * Assume que os inputs já estão normalizados (usa normalizeLocation quem chama).
 */
export function locationDistance(a: string, b: string, maxHops = 3): number {
  if (!a || !b) return Infinity;
  if (a === b) return 0;
  if (!NEIGHBORS.has(a) || !NEIGHBORS.has(b)) return Infinity;
  const visited = new Set<string>([a]);
  let frontier: string[] = [a];
  for (let hop = 1; hop <= maxHops; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      const nbrs = NEIGHBORS.get(node);
      if (!nbrs) continue;
      for (const nb of nbrs) {
        if (nb === b) return hop;
        if (!visited.has(nb)) {
          visited.add(nb);
          next.push(nb);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return Infinity;
}