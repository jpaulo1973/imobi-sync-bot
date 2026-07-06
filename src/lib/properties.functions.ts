import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callLovableAI } from "./ai-gateway.server";

const EssentialSchema = z.object({
  referencia: z.string().nullable().optional(),
  finalidade: z.enum(["venda", "arrendamento"]).default("venda"),
  tipo_imovel: z.string().nullable().optional(),
  tipologia: z.string().nullable().optional(),
  preco: z.number().nullable().optional(),
  distrito: z.string().nullable().optional(),
  concelho: z.string().nullable().optional(),
  freguesia: z.string().nullable().optional(),
  zona: z.string().nullable().optional(),
  area_util_m2: z.number().nullable().optional(),
  garagem: z.boolean().nullable().optional(),
  elevador: z.boolean().nullable().optional(),
  jardim: z.boolean().nullable().optional(),
  piscina: z.boolean().nullable().optional(),
});

async function firecrawlScrape(url: string): Promise<{ markdown?: string; html?: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY não configurado");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      url,
      formats: ["markdown", "html"],
      onlyMainContent: false,
      waitFor: 3500,
    }),
  });
  if (res.status === 402) throw new Error("Créditos Firecrawl esgotados. Recarregue a conta.");
  if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: { markdown?: string; html?: string } };
  return json.data ?? {};
}

const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const importPropertyFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ url: z.string().url() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const scrape = await firecrawlScrape(data.url);
    const markdown = (scrape.markdown ?? "").trim();
    const htmlText = stripHtml(scrape.html ?? "");
    const content = [markdown, htmlText].filter(Boolean).join("\n\n").slice(0, 60000);
    if (!content) throw new Error("Não foi possível extrair conteúdo da página.");

    const sys = `És um assistente de mediação imobiliária em Portugal. Recebes o conteúdo de uma página de anúncio (Century 21, Idealista, Imovirtual, Casa Sapo, etc.).

Extrai APENAS os seguintes campos essenciais. Se algum não estiver claro, devolve null. NUNCA inventes.

Schema JSON:
{
  "referencia": string|null,           // ex: "C21-ABC123"
  "finalidade": "venda"|"arrendamento",
  "tipo_imovel": "apartamento"|"moradia"|"terreno"|"escritorio"|"loja"|"quinta"|"outro"|null,
  "tipologia": "T0"|"T1"|"T2"|"T3"|"T4"|"T5+"|"Moradia"|null,
  "preco": number|null,                // em euros, sem símbolos
  "distrito": string|null,
  "concelho": string|null,
  "freguesia": string|null,
  "zona": string|null,                 // bairro/localidade específica dentro da freguesia, quando existir
  "area_util_m2": number|null,         // área útil (não área bruta) em m²
  "garagem": boolean|null,
  "elevador": boolean|null,
  "jardim": boolean|null,
  "piscina": boolean|null
}

Century 21: procura o breadcrumb "Distrito › Concelho › Freguesia", o bloco "Detalhes", a etiqueta "Área útil" (ignora "área bruta"), e ícones de características.
Idealista/Imovirtual: usa a morada indicada e o painel de características.

Responde APENAS com JSON válido.`;

    const raw = await callLovableAI({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `URL: ${data.url}\n\n${content}` },
      ],
    });

    let parsed: z.infer<typeof EssentialSchema>;
    try {
      parsed = EssentialSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error("A IA não conseguiu interpretar o anúncio. Adicione manualmente.");
    }

    // Só recusa se realmente não veio NADA de útil (nem preço, nem localização, nem tipologia/tipo)
    const hasAnything =
      parsed.preco != null ||
      parsed.concelho ||
      parsed.freguesia ||
      parsed.zona ||
      parsed.distrito ||
      parsed.tipologia ||
      parsed.tipo_imovel;
    if (!hasAnything) {
      throw new Error("Não foi possível extrair dados desta página. Adicione manualmente.");
    }

    // Fallback zona a partir de freguesia/concelho para satisfazer NOT NULL
    const zonaFallback =
      parsed.zona ??
      parsed.freguesia ??
      parsed.concelho ??
      parsed.distrito ??
      "Por preencher";

    const { data: saved, error } = await supabase
      .from("properties")
      .insert({
        user_id: userId,
        referencia: parsed.referencia ?? null,
        finalidade: parsed.finalidade,
        tipo_imovel: parsed.tipo_imovel ?? null,
        tipologia: parsed.tipologia ?? "N/D",
        distrito: parsed.distrito ?? null,
        concelho: parsed.concelho ?? null,
        freguesia: parsed.freguesia ?? null,
        zona: zonaFallback,
        preco: parsed.preco ?? 0,
        area_util_m2: parsed.area_util_m2 ?? null,
        area_m2: parsed.area_util_m2 ?? null,
        garagem: parsed.garagem ?? null,
        elevador: parsed.elevador ?? null,
        jardim: parsed.jardim ?? null,
        piscina: parsed.piscina ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const missing_fields: string[] = [];
    if (!parsed.referencia) missing_fields.push("referencia");
    if (!parsed.tipo_imovel) missing_fields.push("tipo_imovel");
    if (!parsed.tipologia) missing_fields.push("tipologia");
    if (parsed.preco == null) missing_fields.push("preco");
    if (!parsed.distrito) missing_fields.push("distrito");
    if (!parsed.concelho) missing_fields.push("concelho");
    if (!parsed.freguesia) missing_fields.push("freguesia");
    if (parsed.area_util_m2 == null) missing_fields.push("area_util_m2");

    return { property: saved, missing_fields };
  });
