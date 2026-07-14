import { createFileRoute } from "@tanstack/react-router";
import { LocationRepository, parseLocations } from "@/lib/geo";

// TEMPORÁRIA — validação Fase 2. Remover após encerramento.
export const Route = createFileRoute("/api/public/_test-geo-fase2")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { text } = (await request.json()) as { text: string };
        LocationRepository.invalidate();
        const snap = await LocationRepository.getSnapshot();
        const result = parseLocations(text, snap);
        if (result.aliases_used.length > 0) {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
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
        }
        return new Response(JSON.stringify(result), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});