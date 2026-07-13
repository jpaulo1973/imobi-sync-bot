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
  area_bruta_m2: z.number().nullable().optional(),
  area_terreno_m2: z.number().nullable().optional(),
  subtipo_imovel: z.string().nullable().optional(),
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
  "tipo_imovel": "apartamento"|"moradia"|"terreno"|"escritorio"|"loja"|"quinta"|"garagem"|"armazem"|"outro"|null,
  "tipologia": "T0"|"T1"|"T2"|"T3"|"T4"|"T5+"|"Moradia"|null,   // null quando não aplicável (terrenos, lojas, garagens, armazéns)
  "subtipo_imovel": string|null,       // subcategoria; ver regras abaixo
  "preco": number|null,                // em euros, sem símbolos
  "distrito": string|null,
  "concelho": string|null,
  "freguesia": string|null,
  "zona": string|null,                 // bairro/localidade específica dentro da freguesia, quando existir
  "area_util_m2": number|null,         // área útil (interior habitável) em m²
  "area_bruta_m2": number|null,        // área bruta (privativa+comum) em m²
  "area_terreno_m2": number|null,      // área do terreno / lote em m² (típico de terrenos, moradias, quintas)
  "garagem": boolean|null,
  "elevador": boolean|null,
  "jardim": boolean|null,
  "piscina": boolean|null
}

Century 21: procura o breadcrumb "Distrito › Concelho › Freguesia", o bloco "Detalhes", e ícones de características. Extrai TODAS as áreas que estejam presentes ("Área útil", "Área bruta", "Área do terreno" / "Área do lote") em campos separados — não escolhas por ti, devolve os três valores quando existirem.
Idealista/Imovirtual: usa a morada indicada e o painel de características.

Para terrenos, lojas, garagens e armazéns a tipologia (T0..T5) não se aplica — devolve null.

SUBTIPO DE IMÓVEL:
Prioriza sempre os campos estruturados da página (breadcrumb, badges, categoria, título). Só se não existirem, analisa a DESCRIÇÃO do anúncio.
Para tipo_imovel = "terreno", devolve um dos seguintes (exatamente, em minúsculas):
  "urbano", "rustico", "urbanizavel", "misto", "construcao", "agricola", "industrial", "comercial", "florestal", "nao identificado"
Regras de interpretação para terrenos (aplica também sinónimos e variações comuns):
  - "para construção", "com viabilidade construtiva", "PIP aprovado", "lote" → "construcao"
  - "urbano", "em zona urbana", "solo urbano" → "urbano"
  - "rústico", "rustico" → "rustico"
  - "urbanizável", "urbanizavel", "expansão urbana" → "urbanizavel"
  - "misto" → "misto"
  - "agrícola", "cultivo", "vinha", "olival", "pomar" → "agricola"
  - "industrial", "logístico", "armazenagem" → "industrial"
  - "comercial" → "comercial"
  - "floresta", "florestal", "pinhal", "eucaliptal", "mata" → "florestal"
  - Se nada disto ficar claro → "nao identificado"
Para outros tipos de imóvel (apartamento, moradia, loja, escritório, quinta, garagem, armazém), devolve null salvo se a página indicar claramente uma subcategoria (ex.: "duplex", "penthouse", "geminada", "isolada") — nesse caso devolve-a em minúsculas sem acentos.

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

    // Seleciona a área mais adequada consoante o tipo de imóvel.
    const tipoNorm = (parsed.tipo_imovel ?? "").toLowerCase();
    const isTerreno = tipoNorm === "terreno";
    const isRustico = tipoNorm === "quinta";
    const areaCandidates = isTerreno
      ? [parsed.area_terreno_m2, parsed.area_bruta_m2, parsed.area_util_m2]
      : isRustico
        ? [parsed.area_util_m2, parsed.area_bruta_m2, parsed.area_terreno_m2]
        : [parsed.area_util_m2, parsed.area_bruta_m2, parsed.area_terreno_m2];
    const chosenArea = areaCandidates.find((v) => v != null && Number(v) > 0) ?? null;

    // Subtipo: para terrenos garante um valor final; para outros tipos deixa passar o que vier.
    let subtipoFinal: string | null = parsed.subtipo_imovel
      ? parsed.subtipo_imovel.toLowerCase().trim()
      : null;
    if (isTerreno && !subtipoFinal) subtipoFinal = "nao identificado";

    // Tipologia (T0..T5) não se aplica a alguns tipos — força "N/D".
    const tipologiaNaoAplicavel = ["terreno", "loja", "garagem", "armazem", "escritorio"].includes(tipoNorm);
    const tipologiaFinal = parsed.tipologia
      ? parsed.tipologia
      : tipologiaNaoAplicavel
        ? "N/D"
        : "N/D";

    const { data: saved, error } = await supabase
      .from("properties")
      .insert({
        user_id: userId,
        referencia: parsed.referencia ?? null,
        finalidade: parsed.finalidade,
        tipo_imovel: parsed.tipo_imovel ?? null,
        subtipo_imovel: subtipoFinal,
        tipologia: tipologiaFinal,
        distrito: parsed.distrito ?? null,
        concelho: parsed.concelho ?? null,
        freguesia: parsed.freguesia ?? null,
        zona: zonaFallback,
        preco: parsed.preco ?? 0,
        area_util_m2: chosenArea,
        area_m2: chosenArea,
        // Correções 1.3: guardar SEMPRE área de terreno em coluna própria
        // quando o CRM a expõe. Essencial para quintas, herdades e terrenos
        // — o Motor Match passa a poder usá-la de forma independente da
        // área útil.
        area_terreno_m2: parsed.area_terreno_m2 ?? null,
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
    if (!parsed.tipologia && !tipologiaNaoAplicavel) missing_fields.push("tipologia");
    if (parsed.preco == null) missing_fields.push("preco");
    if (!parsed.distrito) missing_fields.push("distrito");
    if (!parsed.concelho) missing_fields.push("concelho");
    if (!parsed.freguesia) missing_fields.push("freguesia");
    if (chosenArea == null) missing_fields.push("area");

    return { property: saved, missing_fields };
  });
