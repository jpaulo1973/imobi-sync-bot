// Acesso a dados que atravessam utilizadores (Base Global) SEM service_role.
//
// Contexto arquitetural: a chave de serviço só existe no runtime do Lovable
// Cloud. Para a app funcionar em qualquer host (ex.: Vercel) com apenas a
// publishable/anon key, todo o acesso privilegiado passa por funções
// SECURITY DEFINER na base de dados, executadas com o JWT do utilizador
// autenticado (role `authenticated`). Nunca se importa aqui
// `client.server.ts`.
//
// As funções SQL correspondentes aplicam as mesmas regras de privacidade da
// camada `opportunity-privacy.ts` (contactos do lead só para o dono/admin).

type Sb = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

let _client: Sb | null = null;

/**
 * Regista o cliente autenticado do pedido em curso. Deve ser chamado no
 * início de cada handler que dependa (direta ou indiretamente) de leituras
 * da Base Global.
 */
export function setRequestClient(sb: unknown): void {
  if (sb) _client = sb as Sb;
}

/**
 * Devolve o cliente autenticado do pedido. Se nenhum handler o registou,
 * reconstrói-o a partir do cabeçalho Authorization do pedido em curso — de
 * forma a nunca depender da service_role key.
 */
export async function getRequestClient(): Promise<any> {
  if (_client) return _client as any;
  const { getRequest } = await import("@tanstack/react-start/server");
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['SUPABASE_ANON_KEY'];
  const authHeader = getRequest()?.headers?.get("authorization") ?? null;
  if (!url || !key || !authHeader) {
    throw new Error(
      "Cliente autenticado indisponível — chamar setRequestClient(context.supabase) no handler.",
    );
  }
  const client = createClient(url, key, {
    global: { headers: { Authorization: authHeader } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  _client = client as unknown as Sb;
  return client;
}

export function requireRequestClient(): Sb {
  if (!_client) {
    throw new Error(
      "Cliente autenticado não inicializado — chamar setRequestClient(context.supabase) no handler.",
    );
  }
  return _client;
}

async function rpc<T>(fn: string, args: Record<string, unknown> | undefined, sb?: unknown): Promise<T> {
  const client = (sb as Sb | undefined) ?? ((await getRequestClient()) as Sb);
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Todos os imóveis ativos (Base Global). */
export function poolProperties(sb?: unknown): Promise<any[]> {
  return rpc<any[]>("pool_properties", undefined, sb).then((r) => r ?? []);
}

/** Todas as procuras (Base Global). Contactos do lead mascarados p/ terceiros. */
export function poolActiveSearches(
  opts?: { includeExpired?: boolean },
  sb?: unknown,
): Promise<any[]> {
  return rpc<any[]>(
    "pool_active_searches",
    { p_include_expired: opts?.includeExpired ?? false },
    sb,
  ).then((r) => r ?? []);
}

/** Compradores ativos (Base Global). Dados pessoais só do próprio consultor. */
export function poolBuyerClients(sb?: unknown): Promise<any[]> {
  return rpc<any[]>("pool_buyer_clients", undefined, sb).then((r) => r ?? []);
}

export type ConsultorRow = {
  id: string;
  full_name: string | null;
  agency: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  ativo: boolean | null;
};

/** Diretório de consultores (nome, agência, telefone, whatsapp, email). */
export function consultorDirectoryRows(sb?: unknown): Promise<ConsultorRow[]> {
  return rpc<ConsultorRow[]>("consultor_directory", undefined, sb).then((r) => r ?? []);
}

export type MatchOpportunityRow = {
  id: string;
  user_id: string;
  property_id: string;
  active_search_id: string;
  score: number;
};

export function listMatchOpportunities(
  searchIds: string[],
  sb?: unknown,
): Promise<MatchOpportunityRow[]> {
  if (searchIds.length === 0) return Promise.resolve([]);
  return rpc<MatchOpportunityRow[]>(
    "list_match_opportunities",
    { p_search_ids: searchIds },
    sb,
  ).then((r) => r ?? []);
}

export type OpportunityUpsert = {
  user_id: string;
  property_id: string;
  active_search_id: string;
  score: number;
  reasons: unknown;
  categories: unknown;
};

/** Insere/atualiza oportunidades (inclui imóveis de outros consultores). */
export async function applyMatchOpportunities(
  rows: OpportunityUpsert[],
  sb?: unknown,
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  const CHUNK = 300;
  for (let i = 0; i < rows.length; i += CHUNK) {
    inserted += Number(
      (await rpc<number>("apply_match_opportunities", { p_rows: rows.slice(i, i + CHUNK) }, sb)) ?? 0,
    );
  }
  return inserted;
}

export type NotificationInsert = {
  user_id: string;
  pair_key: string;
  buyer_source: string;
  buyer_ref: string;
  property_id: string;
  buyer_label: string | null;
  property_label: string | null;
  score: number;
  reason_summary: string | null;
};

/** Cria notificações (também para o consultor dono do imóvel). */
export async function insertMatchNotifications(
  rows: NotificationInsert[],
  sb?: unknown,
): Promise<number> {
  if (rows.length === 0) return 0;
  return Number((await rpc<number>("insert_match_notifications", { p_rows: rows }, sb)) ?? 0);
}

export function touchLocationAlias(aliasId: string, sb?: unknown): Promise<void> {
  return rpc<void>("touch_location_alias", { p_id: aliasId }, sb);
}

export function upsertLocationAlias(
  alias: string,
  locationIds: string[],
  origem: string,
  sb?: unknown,
): Promise<string> {
  return rpc<string>(
    "upsert_location_alias",
    { p_alias: alias, p_ids: locationIds, p_origem: origem },
    sb,
  );
}
