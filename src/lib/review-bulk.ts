// ---------------------------------------------------------------------------
// Reimportação em lote da Revisão — planeamento puro (testável).
//
// Uma linha do ficheiro pode trazer `telefone_novo` e/ou `nome_novo`.
// Esta função decide, sem tocar na base de dados, que patches aplicar a cada
// procura e que pares (nome, telefone) devem ser aprendidos em `contacts`.
// Regra de ordem: a aprendizagem usa SEMPRE o nome já corrigido (`nome_novo`),
// nunca o nome antigo que ainda está gravado.
// ---------------------------------------------------------------------------

import { buildDedupKey, normalizePhone } from "./dedup";
import { normContactName } from "./contacts.server";

export type BulkLineInput = {
  linha: number;
  search_ids: string[];
  telefone?: string | null;
  nome_novo?: string | null;
};

export type BulkSearchRow = {
  id: string;
  contact_nome?: string | null;
  consultor_nome?: string | null;
  contact_telefone?: string | null;
  consultor_telefone?: string | null;
  criteria?: Record<string, any> | null;
};

export type BulkLinePlan = {
  /** Patches por procura (vazio quando nada muda). */
  patches: Array<{ id: string; patch: Record<string, unknown> }>;
  /** Pares a aprender em `contacts` (só quando há telefone válido). */
  learn: Array<{ nome: string; telefone: string }>;
  /** Telefone normalizado, quando fornecido e válido. */
  telefone?: string;
  /** true quando o nome foi efetivamente alterado em alguma procura. */
  nome_aplicado: boolean;
  error?: string;
};

export function planBulkLine(line: BulkLineInput, rows: BulkSearchRow[]): BulkLinePlan {
  const empty: BulkLinePlan = { patches: [], learn: [], nome_aplicado: false };
  const telRaw = (line.telefone ?? "").trim();
  const nomeNovo = (line.nome_novo ?? "").trim();

  let norm: string | undefined;
  if (telRaw) {
    const n = normalizePhone(telRaw);
    if (!n || n.length < 9) {
      return { ...empty, error: "Número de telefone inválido (mínimo 9 dígitos)." };
    }
    norm = n;
  }
  if (nomeNovo && normContactName(nomeNovo).length < 2) {
    return { ...empty, error: "nome_novo sem conteúdo utilizável." };
  }
  if (!telRaw && !nomeNovo) {
    return { ...empty, error: "Linha sem telefone_novo nem nome_novo." };
  }
  if (rows.length === 0) {
    return { ...empty, error: "Nenhuma procura ativa encontrada para os search_ids indicados." };
  }

  const patches: BulkLinePlan["patches"] = [];
  const learnKeys = new Map<string, { nome: string; telefone: string }>();
  let nomeAplicado = false;

  for (const r of rows) {
    const nomeAtual = (r.contact_nome ?? r.consultor_nome ?? "").trim();
    const trocaNome =
      nomeNovo.length > 0 && normContactName(nomeNovo) !== normContactName(nomeAtual);
    const nomeFinal = trocaNome ? nomeNovo : nomeAtual;

    const patch: Record<string, unknown> = {};
    if (trocaNome) {
      nomeAplicado = true;
      patch.contact_nome = nomeNovo;
      const c = (r.criteria ?? {}) as any;
      const telefoneEfetivo = norm ?? r.contact_telefone ?? r.consultor_telefone ?? null;
      patch.dedup_key = buildDedupKey({
        telefone: telefoneEfetivo,
        nome: nomeFinal,
        finalidade: c.finalidade ?? "indefinido",
        tipologia: c.tipologia ?? null,
        tipo_imovel: c.tipo_imovel ?? null,
        zona: c.zona ?? c.municipio ?? c.freguesia ?? null,
      });
    }
    if (norm) {
      patch.consultor_telefone = telRaw;
      patch.flagged_for_review = false;
    }
    if (Object.keys(patch).length > 0) patches.push({ id: r.id, patch });

    if (norm && nomeFinal) {
      const key = `${normContactName(nomeFinal)}|${norm}`;
      if (!learnKeys.has(key)) learnKeys.set(key, { nome: nomeFinal, telefone: norm });
    }
  }

  return {
    patches,
    learn: Array.from(learnKeys.values()),
    telefone: norm,
    nome_aplicado: nomeAplicado,
  };
}
