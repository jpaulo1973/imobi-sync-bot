// Server functions expostas ao cliente para consulta e resolução geográfica.
// Toda a leitura passa obrigatoriamente pelo LocationRepository — nunca
// SQL direto de outros ficheiros.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LocationRepository, normalizeGeoText, parseLocations } from "@/lib/geo";
import type { LocationType, ParseResult, Location } from "@/lib/geo";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const searchSchema = z.object({
  text: z.string().max(200),
  tipo: z.enum(["distrito", "concelho", "freguesia", "zona_funcional"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const searchLocations = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => searchSchema.parse(data))
  .handler(async ({ data }): Promise<Location[]> => {
    return LocationRepository.search(data.text, {
      tipo: data.tipo as LocationType | undefined,
      limit: data.limit ?? 20,
    });
  });

const resolveSchema = z.object({ text: z.string().max(1000) });

export const resolveLocationText = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => resolveSchema.parse(data))
  .handler(async ({ data }): Promise<ParseResult> => {
    const snap = await LocationRepository.getSnapshot();
    const result = parseLocations(data.text, snap);
    // Registar utilização real dos aliases resolvidos automaticamente.
    // times_used representa reutilizações efectivas do alias pelo parser —
    // nunca é incrementado na criação/promoção (essa é uma acção humana).
    if (result.aliases_used.length > 0) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowIso = new Date().toISOString();
        await Promise.all(
          result.aliases_used.map(async (aliasId) => {
            const aliasRow = snap.aliases.find((a) => a.id === aliasId);
            const next = (aliasRow?.times_used ?? 0) + 1;
            await supabaseAdmin
              .from("location_aliases")
              .update({ times_used: next, last_used_at: nowIso })
              .eq("id", aliasId);
          }),
        );
      } catch {
        // Contador é telemetria — não deve bloquear a resolução.
      }
    }
    return result;
  });

const byIdsSchema = z.object({ ids: z.array(z.string().uuid()).max(200) });

export const getLocationsByIds = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => byIdsSchema.parse(data))
  .handler(async ({ data }): Promise<Location[]> => {
    const snap = await LocationRepository.getSnapshot();
    const out: Location[] = [];
    for (const id of data.ids) {
      const l = snap.byId.get(id);
      if (l) out.push(l);
    }
    return out;
  });

// promoteAlias — aprendizagem explícita e auditável.
// Regista (ou reforça) um alias humano → conjunto de location_ids,
// aprovado, para que futuras ocorrências do mesmo texto original sejam
// resolvidas automaticamente pelo parser. Nunca deve ser chamada sem
// confirmação humana explícita.
const promoteAliasSchema = z.object({
  text: z.string().min(1).max(200),
  location_ids: z.array(z.string().uuid()).min(1).max(20),
  origem: z.string().max(40).optional(),
});

export const promoteAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => promoteAliasSchema.parse(data))
  .handler(async ({ data, context }) => {
    const alias = normalizeGeoText(data.text);
    if (!alias) throw new Error("Texto inválido para alias");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Validar que todos os IDs existem na biblioteca.
    const snap = await LocationRepository.getSnapshot();
    const validIds = data.location_ids.filter((id) => snap.byId.has(id));
    if (validIds.length === 0) throw new Error("Nenhum location_id válido");

    const { data: existing } = await supabaseAdmin
      .from("location_aliases")
      .select("id, times_used, location_ids")
      .eq("alias_normalizado", alias)
      .maybeSingle();

    if (existing) {
      const { error } = await supabaseAdmin
        .from("location_aliases")
        .update({
          location_ids: validIds,
          aprovado: true,
          origem: data.origem ?? "revisao",
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("location_aliases").insert({
        alias_normalizado: alias,
        location_ids: validIds,
        aprovado: true,
        origem: data.origem ?? "revisao",
        times_used: 0,
        last_used_at: null,
        created_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    // Invalidar cache para que o parser passe a reconhecer o alias.
    LocationRepository.invalidate();
    return { ok: true as const, alias, location_ids: validIds };
  });