import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callLovableAI } from "./ai-gateway.server";

const PropertySchema = z.object({
  referencia: z.string().nullable().optional(),
  finalidade: z.enum(["venda", "arrendamento"]).default("venda"),
  tipologia: z.string().nullable().optional(),
  zona: z.string().nullable().optional(),
  concelho: z.string().nullable().optional(),
  preco: z.number().nullable().optional(),
  area_m2: z.number().nullable().optional(),
  quartos: z.number().nullable().optional(),
  casas_banho: z.number().nullable().optional(),
  descricao: z.string().nullable().optional(),
  caracteristicas: z.string().nullable().optional(),
});

async function firecrawlScrape(url: string): Promise<{ markdown?: string; html?: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY não configurado");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url, formats: ["markdown", "html"], onlyMainContent: false, waitFor: 2500 }),
  });
  if (res.status === 402) throw new Error("CREDITOS_FIRECRAWL_ESGOTADOS");
  if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: { markdown?: string; html?: string } };
  return json.data ?? {};
}

export const importPropertyFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ url: z.string().url() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const scrape = await firecrawlScrape(data.url);
    const markdown = scrape.markdown ?? "";
    const htmlText = (scrape.html ?? "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const content = [markdown, htmlText].filter(Boolean).join("\n\n").slice(0, 30000);
    if (!content) throw new Error("Não foi possível extrair conteúdo da página.");

    const sys = `És um assistente de mediação imobiliária. Recebes o conteúdo (markdown) de uma página de anúncio de imóvel (Century 21, Idealista, Imovirtual, Casa Sapo, etc.).
Extrai os dados do imóvel. Responde APENAS com JSON válido com este schema:
{"referencia":string|null,"finalidade":"venda"|"arrendamento","tipologia":string|null,"zona":string|null,"concelho":string|null,"preco":number|null,"area_m2":number|null,"quartos":number|null,"casas_banho":number|null,"descricao":string|null,"caracteristicas":string|null}
- preco em euros (número, sem símbolos).
- tipologia: "T0","T1","T2","T3","T4","T5+" ou "Moradia".
- caracteristicas: lista curta separada por vírgulas (ex: "garagem, varanda, vista mar").
- Se algum campo não estiver claro, devolve null.`;

    const raw = await callLovableAI({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `URL: ${data.url}\n\n${content}` },
      ],
    });

    let parsed: z.infer<typeof PropertySchema>;
    try {
      parsed = PropertySchema.parse(JSON.parse(raw));
    } catch {
      throw new Error("A IA não conseguiu interpretar o anúncio.");
    }

    const missing: string[] = [];
    if (!parsed.tipologia) missing.push("tipologia");
    if (!parsed.zona) missing.push("zona");
    if (parsed.preco == null) missing.push("preço");
    // Só recusa se realmente não veio nada de útil
    if (missing.length === 3) {
      throw new Error("Não foi possível extrair dados desta página. Adicione manualmente.");
    }

    const { data: saved, error } = await supabase
      .from("properties")
      .insert({
        user_id: userId,
        referencia: parsed.referencia ?? null,
        finalidade: parsed.finalidade,
        tipologia: parsed.tipologia ?? "N/D",
        zona: parsed.zona ?? "N/D",
        concelho: parsed.concelho ?? null,
        preco: parsed.preco ?? 0,
        area_m2: parsed.area_m2 ?? null,
        quartos: parsed.quartos ?? null,
        casas_banho: parsed.casas_banho ?? null,
        descricao: parsed.descricao ?? null,
        caracteristicas: parsed.caracteristicas ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return {
      property: saved,
      warning: missing.length
        ? `Importado com campos em falta: ${missing.join(", ")}. Edite o imóvel para completar.`
        : null,
    };
  });