// ---------------------------------------------------------------------------
// Backfill de contactos — agregador puro (sem I/O, testável).
//
// Regra ÚNICA de segurança (aprovada 19/08): só semeamos um nome quando ele
// tem EXACTAMENTE um telefone distinto em todo o histórico. Nomes com mais do
// que um número nunca são resolvidos automaticamente — nem por frequência nem
// por recência — porque os dados provaram que a maioria erra:
//   · rótulos genéricos ("Club Member", "Colega", "Item") juntam centenas de
//     pessoas diferentes sob o mesmo nome;
//   · nomes de agência ("Century 21") juntam vários consultores;
//   · homónimos reais ("Bernardo Santos", "Cristina Oliveira") têm emails de
//     domínios diferentes;
//   · em "Rui Ferreirinha" o número MAIS frequente é o que não tem email
//     confirmado.
// Esses nomes saem num relatório para decisão manual.
// ---------------------------------------------------------------------------

// Nota: a normalização de nome é replicada aqui (em vez de importada de
// `contacts.server.ts`) porque este módulo é alcançável pelo bundle do
// cliente através de `contacts-backfill.functions.ts`, e ficheiros
// `*.server.ts` estão bloqueados nesse bundle. O teste
// `contacts-backfill.test.ts` garante paridade com `normContactName`.
export function normNameForBackfill(raw?: string | null): string {
  if (!raw) return "";
  return String(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type BackfillSourceRow = {
  user_id: string;
  /** false quando o consultor da procura já não existe (conta apagada). */
  user_exists?: boolean | null;
  contact_nome?: string | null;
  consultor_nome?: string | null;
  contact_telefone?: string | null;
  consultor_telefone?: string | null;
  contact_email?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SeedPair = {
  user_id: string;
  nome_normalizado: string;
  nome_display: string | null;
  telefone: string;
  email: string | null;
  times_seen: number;
  last_seen_at: string;
};

export type AmbiguousName = {
  nome_normalizado: string;
  nomes_display: string[];
  telefones: Array<{
    telefone: string;
    procuras: number;
    primeira: string;
    ultima: string;
    emails: string[];
  }>;
};

export type AggregateResult = {
  linhas_lidas: number;
  linhas_ignoradas: number;
  nomes_distintos: number;
  nomes_ambiguos: number;
  /** Pares de consultores apagados: nunca gravados (FK contacts→auth.users). */
  orfaos_pares: number;
  orfaos_nomes: string[];
  pares: SeedPair[];
  ambiguos: AmbiguousName[];
};

/** Telefone efetivo: comprador primeiro, consultor a seguir. Só dígitos PT. */
export function effectivePhoneRaw(row: BackfillSourceRow): string | null {
  const pick = (v?: string | null) => {
    const t = (v ?? "").trim();
    return t.length > 0 ? t : null;
  };
  return pick(row.contact_telefone) ?? pick(row.consultor_telefone);
}

/** Mesma normalização de `normalize_phone_pt` no servidor. */
export function normalizePhoneStrict(raw?: string | null): string | null {
  if (!raw) return null;
  let s = String(raw).replace(/\D+/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = s.slice(2);
  if (s.startsWith("351") && s.length > 9) s = s.slice(-9);
  if (s.length < 9) return null;
  return s;
}

function seenAt(row: BackfillSourceRow): string {
  const a = row.created_at ?? null;
  const b = row.updated_at ?? null;
  if (a && b) return a > b ? a : b;
  return a ?? b ?? new Date().toISOString();
}

/**
 * Agrega as linhas por (utilizador, nome normalizado, telefone) e separa os
 * pares seguros dos nomes ambíguos. Nunca escreve nada.
 */
export function aggregateContacts(rows: BackfillSourceRow[]): AggregateResult {
  type Acc = {
    user_id: string;
    key: string;
    telefone: string;
    display: string | null;
    email: string | null;
    count: number;
    first: string;
    last: string;
    orphan?: boolean;
  };
  const byPair = new Map<string, Acc>();
  // Telefones distintos por NOME (independente do utilizador): a ambiguidade
  // é uma propriedade do nome, não da carteira de quem importou.
  const phonesByName = new Map<string, Set<string>>();
  const displaysByName = new Map<string, Set<string>>();
  let ignoradas = 0;
  let orfaosPares = 0;
  const orfaosNomes = new Set<string>();

  for (const row of rows) {
    const nomeRaw = (row.contact_nome ?? "").trim() || (row.consultor_nome ?? "").trim();
    const key = normNameForBackfill(nomeRaw);
    const tel = normalizePhoneStrict(effectivePhoneRaw(row));
    if (!key || !tel || !row.user_id) {
      ignoradas++;
      continue;
    }
    const when = seenAt(row);
    const pairId = `${row.user_id}|${key}|${tel}`;
    const prev = byPair.get(pairId);
    if (prev) {
      prev.count++;
      if (when < prev.first) prev.first = when;
      if (when > prev.last) prev.last = when;
      if (!prev.email) prev.email = (row.contact_email ?? "").trim() || null;
    } else {
      byPair.set(pairId, {
        user_id: row.user_id,
        key,
        telefone: tel,
        display: nomeRaw || null,
        email: (row.contact_email ?? "").trim() || null,
        count: 1,
        first: when,
        last: when,
      });
    }
    if (!phonesByName.has(key)) phonesByName.set(key, new Set());
    phonesByName.get(key)!.add(tel);
    if (nomeRaw) {
      if (!displaysByName.has(key)) displaysByName.set(key, new Set());
      displaysByName.get(key)!.add(nomeRaw);
    }
    if (row.user_exists === false) {
      orfaosNomes.add(key);
      byPair.get(pairId)!.orphan = true;
    }
  }

  const ambiguousKeys = new Set(
    [...phonesByName.entries()].filter(([, tels]) => tels.size > 1).map(([k]) => k),
  );

  const pares: SeedPair[] = [];
  const ambMap = new Map<string, AmbiguousName>();
  for (const acc of byPair.values()) {
    // Consultor apagado: a FK contacts→auth.users rejeitaria a linha.
    if (acc.orphan) {
      orfaosPares++;
      continue;
    }
    if (ambiguousKeys.has(acc.key)) {
      let entry = ambMap.get(acc.key);
      if (!entry) {
        entry = {
          nome_normalizado: acc.key,
          nomes_display: [...(displaysByName.get(acc.key) ?? [])],
          telefones: [],
        };
        ambMap.set(acc.key, entry);
      }
      const existing = entry.telefones.find((t) => t.telefone === acc.telefone);
      if (existing) {
        existing.procuras += acc.count;
        if (acc.first < existing.primeira) existing.primeira = acc.first;
        if (acc.last > existing.ultima) existing.ultima = acc.last;
        if (acc.email && !existing.emails.includes(acc.email)) existing.emails.push(acc.email);
      } else {
        entry.telefones.push({
          telefone: acc.telefone,
          procuras: acc.count,
          primeira: acc.first,
          ultima: acc.last,
          emails: acc.email ? [acc.email] : [],
        });
      }
      continue;
    }
    pares.push({
      user_id: acc.user_id,
      nome_normalizado: acc.key,
      nome_display: acc.display,
      telefone: acc.telefone,
      email: acc.email,
      times_seen: acc.count,
      last_seen_at: acc.last,
    });
  }

  const ambiguos = [...ambMap.values()]
    .map((a) => ({
      ...a,
      telefones: a.telefones.sort((x, y) => y.procuras - x.procuras),
    }))
    .sort((a, b) => b.telefones.length - a.telefones.length);

  return {
    linhas_lidas: rows.length,
    linhas_ignoradas: ignoradas,
    nomes_distintos: phonesByName.size,
    nomes_ambiguos: ambiguousKeys.size,
    orfaos_pares: orfaosPares,
    orfaos_nomes: [...orfaosNomes].sort(),
    pares: pares.sort((a, b) => b.times_seen - a.times_seen),
    ambiguos,
  };
}