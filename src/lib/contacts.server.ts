// ---------------------------------------------------------------------------
// Contactos persistentes (tabela `contacts`).
//
// Motivação: até aqui o telefone vivia apenas na linha de `active_searches`.
// Uma reimportação de um ficheiro sem telefone criava procuras novamente sem
// número, obrigando a corrigir manualmente a mesma pessoa em cada importação.
// A tabela `contacts` guarda o par (nome normalizado, telefone) por consultor
// e é consultada em lote no início de cada importação.
//
// Escrita/leitura via RPC SECURITY DEFINER (`contacts_upsert`,
// `contacts_lookup`) para manter as regras de acesso no servidor.
// ---------------------------------------------------------------------------

import { normalizePhone } from "./dedup";

export type KnownContact = {
  nome_normalizado: string;
  nome_display: string | null;
  telefone: string;
  email: string | null;
  agency: string | null;
  times_seen: number;
};

/** Chave canónica de pessoa: minúsculas, sem acentos, sem pontuação. */
export function normContactName(raw?: string | null): string {
  if (!raw) return "";
  return String(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Carrega em UMA query todos os contactos conhecidos para a lista de nomes.
 * Devolve um mapa nome normalizado → contacto (o mais usado/recente).
 */
export async function lookupContacts(
  supabase: any,
  nomes: Array<string | null | undefined>,
): Promise<Map<string, KnownContact>> {
  const unique = Array.from(
    new Set(nomes.map((n) => (n ?? "").trim()).filter((n) => normContactName(n).length > 0)),
  );
  const out = new Map<string, KnownContact>();
  if (unique.length === 0) return out;
  try {
    const { data, error } = await supabase.rpc("contacts_lookup", { p_nomes: unique });
    if (error) {
      console.error("[contacts] lookup failed", error.message);
      return out;
    }
    for (const r of (data ?? []) as KnownContact[]) {
      // A RPC devolve ordenado por times_seen desc → o primeiro ganha.
      if (!out.has(r.nome_normalizado)) out.set(r.nome_normalizado, r);
    }
  } catch (e) {
    console.error("[contacts] lookup threw", e);
  }
  return out;
}

/** Telefone conhecido para um nome, ou null. */
export function knownPhoneFor(
  contacts: Map<string, KnownContact>,
  nome?: string | null,
): string | null {
  const key = normContactName(nome);
  if (!key) return null;
  return contacts.get(key)?.telefone ?? null;
}

/**
 * Grava/atualiza um contacto. Idempotente: repetições incrementam `times_seen`.
 * Nunca lança — a falha de aprendizagem não deve quebrar uma importação.
 */
export async function saveContact(
  supabase: any,
  input: {
    nome?: string | null;
    telefone?: string | null;
    email?: string | null;
    agency?: string | null;
    origem?: "import" | "revisao" | "manual";
  },
): Promise<boolean> {
  const nome = (input.nome ?? "").trim();
  const tel = normalizePhone(input.telefone);
  if (!normContactName(nome) || !tel || tel.length < 9) return false;
  try {
    const { error } = await supabase.rpc("contacts_upsert", {
      p_nome: nome,
      p_telefone: tel,
      p_email: input.email ?? null,
      p_agency: input.agency ?? null,
      p_origem: input.origem ?? "import",
    });
    if (error) {
      console.error("[contacts] upsert failed", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[contacts] upsert threw", e);
    return false;
  }
}
