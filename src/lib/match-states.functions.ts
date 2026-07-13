import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Release 1.3 — Estado por par Imóvel↔Comprador.
//
// O estado pertence ao angariador (dono do imóvel). Não afeta o comprador
// nem outros imóveis. Estados: 'novo' (default implícito), 'contactado',
// 'nao_interessado'. Marcar como 'nao_interessado' remove o par apenas da
// lista ativa deste imóvel.

const StateEnum = z.enum(["novo", "contactado", "nao_interessado"]);
const SourceEnum = z.enum(["cliente", "search"]);

export type MatchStateValue = z.infer<typeof StateEnum>;
export type MatchStateSource = z.infer<typeof SourceEnum>;

export type MatchStateRow = {
  property_id: string;
  buyer_source: MatchStateSource;
  buyer_ref: string;
  state: MatchStateValue;
  updated_at: string | null;
};

export const listMatchStatesForProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ propertyId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("match_states")
      .select("property_id, buyer_source, buyer_ref, state, updated_at")
      .eq("user_id", userId)
      .eq("property_id", data.propertyId);
    if (error) throw new Error(error.message);
    return { states: (rows ?? []) as MatchStateRow[] };
  });

export const updateMatchState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        propertyId: z.string().uuid(),
        buyerSource: SourceEnum,
        buyerRef: z.string().uuid(),
        state: StateEnum,
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Verifica ownership do imóvel via RLS antes de escrever.
    const { data: prop, error: pErr } = await supabase
      .from("properties")
      .select("id")
      .eq("id", data.propertyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prop) throw new Error("Imóvel não encontrado.");

    const { error } = await supabase.from("match_states").upsert(
      {
        user_id: userId,
        property_id: data.propertyId,
        buyer_source: data.buyerSource,
        buyer_ref: data.buyerRef,
        state: data.state,
      },
      { onConflict: "property_id,buyer_source,buyer_ref" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });