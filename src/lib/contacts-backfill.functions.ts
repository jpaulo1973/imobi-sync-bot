// ---------------------------------------------------------------------------
// Backfill único de `contacts` a partir do histórico de `active_searches`.
//
// Só grava pares (nome, telefone) de nomes com UM único telefone distinto no
// histórico. Os nomes ambíguos não escrevem nada — saem num relatório para
// decisão manual (Revisão → telefone novo).
//
// Não altera nenhuma coluna de `active_searches`.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aggregateContacts, type AmbiguousName } from "./contacts-backfill";

export type ContactsBackfillResult = {
  linhas_lidas: number;
  linhas_ignoradas: number;
  nomes_distintos: number;
  nomes_ambiguos: number;
  pares_elegiveis: number;
  semeados: number;
  reforcados: number;
  ignorados_servidor: number;
  ambiguos: AmbiguousName[];
  dry_run: boolean;
};

/** Lotes pequenos: uma RPC por lote para não estourar o payload. */
const WRITE_CHUNK = 200;

export const backfillContactsFromSearches = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { dry_run: boolean } => {
    const d = (data ?? {}) as { dry_run?: unknown };
    return { dry_run: d.dry_run === true };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<ContactsBackfillResult> => {
    const { supabase, userId } = context;
    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(`Falha a validar permissões: ${roleErr.message}`);
    if (!isAdmin) throw new Error("Apenas administradores podem executar o backfill.");

    // Leitura via RPC SECURITY DEFINER (admin-gated) — nunca com service role
    // key, que não existe no runtime de produção.
    const PAGE = 1000;
    const rows: any[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data: page, error } = await (supabase.rpc as any)("contacts_backfill_source", {
        p_limit: PAGE,
        p_offset: offset,
      });
      if (error) throw new Error(`Falha a ler o histórico de procuras: ${error.message}`);
      const batch = (page ?? []) as any[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }

    const agg = aggregateContacts(rows);

    let semeados = 0;
    let reforcados = 0;
    let ignorados = 0;

    if (!data.dry_run) {
      for (let i = 0; i < agg.pares.length; i += WRITE_CHUNK) {
        const slice = agg.pares.slice(i, i + WRITE_CHUNK);
        const { data: res, error } = await supabase.rpc("contacts_backfill_apply", {
          p_rows: slice as any,
        });
        if (error) throw new Error(`Falha a gravar contactos: ${error.message}`);
        const r = (res ?? {}) as { semeados?: number; reforcados?: number; ignorados?: number };
        semeados += r.semeados ?? 0;
        reforcados += r.reforcados ?? 0;
        ignorados += r.ignorados ?? 0;
      }
    }

    return {
      linhas_lidas: agg.linhas_lidas,
      linhas_ignoradas: agg.linhas_ignoradas,
      nomes_distintos: agg.nomes_distintos,
      nomes_ambiguos: agg.nomes_ambiguos,
      pares_elegiveis: agg.pares.length,
      semeados,
      reforcados,
      ignorados_servidor: ignorados,
      ambiguos: agg.ambiguos,
      dry_run: data.dry_run,
    };
  });