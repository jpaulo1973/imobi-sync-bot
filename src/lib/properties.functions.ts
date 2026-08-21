import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractPropertyFromUrl, buildPropertyUpdate, IMPORT_UPDATABLE_FIELDS } from "./property-import.server";

export const importPropertyFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ url: z.string().url() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { values, missing_fields } = await extractPropertyFromUrl(data.url);

    // Release 1.2.8 — upsert por (referencia, user_id): a reimportação num
    // perfil nunca toca em registos de outro consultor, porque a procura é
    // sempre filtrada por user_id (e a RLS reforça o mesmo limite).
    const ref = (values.referencia ?? "").trim();
    if (ref) {
      const { data: existing, error: findErr } = await supabase
        .from("properties")
        .select("*")
        .eq("user_id", userId)
        .eq("referencia", ref)
        .order("created_at", { ascending: false })
        .limit(1);
      if (findErr) throw new Error(findErr.message);
      const current = existing?.[0];
      if (current) {
        const { diff } = buildPropertyUpdate(current as Record<string, unknown>, values as Record<string, unknown>);
        return {
          status: "needs_confirmation" as const,
          property: current,
          diff,
          values,
          missing_fields,
        };
      }
    }

    // Release 1.3.1 — nenhum imóvel novo entra sem decisão de categoria: a
    // fonte raramente devolve `categoria`, e sem ela o Motor cruzava o imóvel
    // com procuras de qualquer categoria.
    const { inferPropertyCategory } = await import("./property-category-infer");
    const categoria = inferPropertyCategory(values as Record<string, unknown>).categoria;

    const { data: saved, error } = await supabase
      .from("properties")
      .insert({
        user_id: userId,
        ...values,
        ...(categoria ? { categoria } : {}),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    return { status: "created" as const, property: saved, diff: [], values, missing_fields };
  });

const ImportValuesSchema = z.record(z.string(), z.unknown());

/**
 * Aplica a reimportação a um imóvel existente (mesmo perfil). Só escreve os
 * campos que a fonte controla; descrição, características, categoria, estado e
 * `ativo` ficam intactos.
 */
export const applyPropertyReimport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), values: ImportValuesSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: current, error: findErr } = await supabase
      .from("properties")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!current) throw new Error("Imóvel não encontrado neste perfil.");

    const incoming: Record<string, unknown> = {};
    for (const field of IMPORT_UPDATABLE_FIELDS) {
      if (field in data.values) incoming[field] = data.values[field];
    }
    const { patch, diff } = buildPropertyUpdate(current as Record<string, unknown>, incoming);
    if (Object.keys(patch).length === 0) {
      return { property: current, updated_fields: [] as string[], diff };
    }
    const { data: saved, error } = await supabase
      .from("properties")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { property: saved, updated_fields: Object.keys(patch), diff };
  });
