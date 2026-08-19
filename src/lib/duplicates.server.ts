// Helpers de runtime do painel de Duplicados. Vive fora de
// `duplicates.functions.ts` porque ficheiros com `createServerFn` são
// divididos no build e só podem conter imports, tipos e as declarações das
// server functions.

import { normalizePhone } from "./dedup";

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

