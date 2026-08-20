// Helpers de runtime do painel de Duplicados. Vive fora de
// `duplicates.functions.ts` porque ficheiros com `createServerFn` são
// divididos no build e só podem conter imports, tipos e as declarações das
// server functions.

import { normalizePhone, normalizeTextKey, textJaccard } from "./dedup";

export type DuplicateMember = {
  id: string;
  criteria: any;
  contact_nome: string | null;
  consultor_nome: string | null;
  telefone: string | null;
  texto_original: string | null;
  resumo: string | null;
  created_at: string;
  data_origem: string | null;
  origem: string | null;
  matches_count: number;
  completeness: number;
};

export type DuplicateGroup = {
  key: string;
  pessoa: string;
  telefone: string | null;
  chave_tipo: "telefone" | "nome";
  membros: DuplicateMember[];
  excedentes: number;
  similaridade_texto: number;
};


export const KEEP_SEPARATE_KEY = "dedup_grupos_mantidos_separados";

/**
 * Release 1.2.11 — limiar único de similaridade de texto (0,80) para sugerir um
 * grupo como duplicado, tanto para grupos por telefone como por nome.
 *
 * Antes, grupos por telefone bastavam-se com 0,40. Isso juntava procuras
 * legitimamente diferentes publicadas pelo mesmo telefone (tipicamente
 * consultores que publicam por vários compradores). O sinal real de
 * reimportação repetida é o texto quase idêntico, não o telefone batido.
 */
export const DUPLICATE_SIM_THRESHOLD = 0.8;

/** Similaridade média (Jaccard) entre os textos distintos de um grupo. */
export function groupTextSimilarity(textos: Array<string | null | undefined>): number {
  const distintos = new Set(textos.map((t) => normalizeTextKey(t ?? "")).filter(Boolean));
  if (distintos.size <= 1) return 1;
  const list = [...distintos];
  let acc = 0;
  let n = 0;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      acc += textJaccard(list[i], list[j]);
      n++;
    }
  return n ? acc / n : 0;
}

/** Um grupo só é sugerido quando o texto é quase igual, independente da chave. */
export function shouldSuggestGroup(_tipo: "telefone" | "nome", sim: number): boolean {
  return sim >= DUPLICATE_SIM_THRESHOLD;
}

/**
 * Release 1.2.17 — subagrupamento por similaridade dentro da mesma chave.
 *
 * Antes, a decisão usava a média de similaridade de TODO o grupo de telefone: um
 * único texto legítimo diferente arrastava a média abaixo do limiar e mascarava
 * duplicados idênticos. Agora agrupa-se por **ligação completa**: um membro só
 * entra num cluster se for >= 0,80 semelhante a TODOS os membros já lá dentro.
 * Ligação simples (union-find) é deliberadamente evitada porque juntaria cadeias
 * A~B, B~C com A~C abaixo do limiar (casos históricos Sandra de Sousa Alves /
 * Isabel Santos).
 */
export function clusterByTextSimilarity<T extends { texto_original?: string | null; resumo?: string | null; completeness?: number }>(
  membros: T[],
): Array<{ membros: T[]; similaridade_minima: number }> {
  const items = membros.map((m, i) => ({
    m,
    i,
    txt: normalizeTextKey(m.texto_original ?? m.resumo ?? ""),
  }));
  const n = items.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const s = items[i].txt && items[j].txt
        ? items[i].txt === items[j].txt
          ? 1
          : textJaccard(items[i].txt, items[j].txt)
        : 0;
      sim[i][j] = s;
      sim[j][i] = s;
    }

  // Ordem gulosa estável: membros mais completos primeiro (são os "líderes"
  // naturais do cluster, tal como na ordenação apresentada na UI).
  const order = items
    .map((it) => it.i)
    .sort((a, b) => (membros[b].completeness ?? 0) - (membros[a].completeness ?? 0) || a - b);

  const usados = new Set<number>();
  const out: Array<{ membros: T[]; similaridade_minima: number }> = [];
  for (const seed of order) {
    if (usados.has(seed)) continue;
    const cluster = [seed];
    usados.add(seed);
    for (const cand of order) {
      if (usados.has(cand)) continue;
      if (cluster.every((c) => sim[c][cand] >= DUPLICATE_SIM_THRESHOLD)) {
        cluster.push(cand);
        usados.add(cand);
      }
    }
    if (cluster.length < 2) {
      // Membro isolado: liberta-se para poder ser semente de outro cluster? Não —
      // já foi testado contra todos os candidatos seguintes, logo não forma par.
      continue;
    }
    let min = 1;
    for (let a = 0; a < cluster.length; a++)
      for (let b = a + 1; b < cluster.length; b++) min = Math.min(min, sim[cluster[a]][cluster[b]]);
    out.push({
      membros: cluster.map((idx) => membros[idx]),
      similaridade_minima: min,
    });
  }
  return out;
}


export function completeness(row: any): number {
  const c = (row.criteria ?? {}) as any;
  let s = 0;
  if (row.contact_telefone || row.consultor_telefone) s += 3;
  if (c.finalidade && c.finalidade !== "indefinido") s += 2;
  if (c.tipologia) s += 2;
  if (Array.isArray(c.tipo_imovel) && c.tipo_imovel.length) s += 2;
  if (Array.isArray(row.location_ids) && row.location_ids.length) s += 3;
  if (c.budget_max) s += 2;
  if (c.budget_min) s += 1;
  if (c.area_min) s += 1;
  if (row.texto_original && row.texto_original.length > 40) s += 1;
  return s;
}

export async function readKeepSeparate(supabase: any): Promise<Set<string>> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", KEEP_SEPARATE_KEY)
    .maybeSingle();
  const arr = (data?.value as string[] | undefined) ?? [];
  return new Set(Array.isArray(arr) ? arr : []);
}

