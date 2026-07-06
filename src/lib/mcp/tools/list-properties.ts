import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_properties",
  title: "List properties",
  description: "List the signed-in user's imported properties (imóveis) in Property Match. Returns basic fields like reference, typology, zone, price, area.",
  inputSchema: {
    limit: z.number().int().min(1).max(200).optional().describe("Max rows to return (default 50)."),
    finalidade: z.enum(["venda", "arrendamento"]).optional().describe("Filter by purpose: venda or arrendamento."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, finalidade }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const sb = supabaseForUser(ctx);
    let q = sb.from("properties").select("id, referencia, finalidade, tipologia, zona, concelho, preco, area_m2, quartos, casas_banho, created_at").order("created_at", { ascending: false }).limit(limit ?? 50);
    if (finalidade) q = q.eq("finalidade", finalidade);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { rows: data ?? [] },
    };
  },
});