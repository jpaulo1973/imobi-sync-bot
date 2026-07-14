// Server functions expostas ao cliente para consulta e resolução geográfica.
// Toda a leitura passa obrigatoriamente pelo LocationRepository — nunca
// SQL direto de outros ficheiros.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LocationRepository, parseLocations } from "@/lib/geo";
import type { LocationType, ParseResult, Location } from "@/lib/geo";

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
    return parseLocations(data.text, snap);
  });