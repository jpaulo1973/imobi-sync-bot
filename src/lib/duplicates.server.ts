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

