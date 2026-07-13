import { z } from "zod";
import { callLovableAI } from "./ai-gateway.server";

export const EssentialPropertySchema = z.object({
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

export type ParsedProperty = z.infer<typeof EssentialPropertySchema>;

export type StructuredAreas = {
  area_util_m2: number | null;
  area_bruta_m2: number | null;
  area_terreno_m2: number | null;
};

type PropertyInsert = {
  referencia: string | null;
  finalidade: "venda" | "arrendamento";
  tipo_imovel: string | null;
  subtipo_imovel: string | null;
  tipologia: string;
  distrito: string | null;
  concelho: string | null;
  freguesia: string | null;
  zona: string;
  preco: number;
  area_util_m2: number | null;
  area_bruta_m2: number | null;
  area_m2: number | null;
  area_terreno_m2: number | null;
  garagem: boolean | null;
  elevador: boolean | null;
  jardim: boolean | null;
  piscina: boolean | null;
};

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

async function fetchPublisherHtml(url: string): Promise<string | undefined> {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (host !== "century21.pt" && !host.endsWith(".century21.pt")) return undefined;

  const res = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent":
        "Mozilla/5.0 (compatible; PropertyMatchBot/1.0; +https://imobi-sync-bot.lovable.app)",
    },
  });
  if (!res.ok) return undefined;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) return undefined;
  return res.text();
}

export const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

const normalizeForSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

const parsePtNumber = (raw: string): number | null => {
  const compact = raw.replace(/[\s\u00a0]/g, "");
  if (!compact) return null;
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact.replace(/\./g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const findAreaAfterLabel = (text: string, labels: string[]): number | null => {
  for (const label of labels) {
    const index = text.indexOf(label);
    if (index === -1) continue;
    const after = text.slice(index + label.length, index + label.length + 120);
    const match = after.match(/([0-9](?:[0-9\s.,]*[0-9])?)\s*m\s*(?:2|²)?\b/);
    if (!match) continue;
    const value = parsePtNumber(match[1]);
    if (value != null) return value;
  }
  return null;
};

export function extractStructuredAreasFromHtml(html: string | undefined): StructuredAreas {
  const text = normalizeForSearch(stripHtml(html ?? ""));
  return {
    area_util_m2: findAreaAfterLabel(text, ["area util"]),
    area_bruta_m2: findAreaAfterLabel(text, ["area bruta"]),
    area_terreno_m2: findAreaAfterLabel(text, [
      "area do terreno",
      "area terreno",
      "area de terreno",
      "area do lote",
      "area lote",
    ]),
  };
}

const sameNumber = (a: number | null | undefined, b: number | null | undefined) =>
  a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.001;

export function mergeStructuredAreas(parsed: ParsedProperty, html: string | undefined): ParsedProperty {
  const structured = extractStructuredAreasFromHtml(html);
  const merged: ParsedProperty = { ...parsed };

  if (structured.area_util_m2 != null) merged.area_util_m2 = structured.area_util_m2;
  if (structured.area_bruta_m2 != null) merged.area_bruta_m2 = structured.area_bruta_m2;

  if (structured.area_terreno_m2 != null) {
    merged.area_terreno_m2 = structured.area_terreno_m2;
  } else if (
    sameNumber(merged.area_terreno_m2, structured.area_bruta_m2) ||
    sameNumber(merged.area_terreno_m2, merged.area_bruta_m2)
  ) {
    // Se não existe etiqueta explícita de terreno, nunca gravar a área bruta como terreno.
    merged.area_terreno_m2 = null;
  }

  return merged;
}

export function buildPropertyInsert(parsed: ParsedProperty): {
  values: PropertyInsert;
  missing_fields: string[];
} {
  const hasAnything =
    parsed.preco != null ||
    parsed.concelho ||
    parsed.freguesia ||
    parsed.zona ||
    parsed.distrito ||
    parsed.tipologia ||
    parsed.tipo_imovel;
  if (!hasAnything) throw new Error("Não foi possível extrair dados desta página. Adicione manualmente.");

  const zonaFallback =
    parsed.zona ?? parsed.freguesia ?? parsed.concelho ?? parsed.distrito ?? "Por preencher";

  const tipoNorm = (parsed.tipo_imovel ?? "").toLowerCase();
  const isTerreno = tipoNorm === "terreno";
  const isRustico = tipoNorm === "quinta";
  const areaCandidates = isTerreno
    ? [parsed.area_terreno_m2, parsed.area_util_m2, parsed.area_bruta_m2]
    : isRustico
      ? [parsed.area_util_m2, parsed.area_bruta_m2]
      : [parsed.area_util_m2, parsed.area_bruta_m2];
  const chosenArea = areaCandidates.find((v) => v != null && Number(v) > 0) ?? null;

  let subtipoFinal: string | null = parsed.subtipo_imovel
    ? parsed.subtipo_imovel.toLowerCase().trim()
    : null;
  if (isTerreno && !subtipoFinal) subtipoFinal = "nao identificado";

  const tipologiaNaoAplicavel = ["terreno", "loja", "garagem", "armazem", "escritorio"].includes(tipoNorm);
  const tipologiaFinal = parsed.tipologia ? parsed.tipologia : "N/D";

  const missing_fields: string[] = [];
  if (!parsed.referencia) missing_fields.push("referencia");
  if (!parsed.tipo_imovel) missing_fields.push("tipo_imovel");
  if (!parsed.tipologia && !tipologiaNaoAplicavel) missing_fields.push("tipologia");
  if (parsed.preco == null) missing_fields.push("preco");
  if (!parsed.distrito) missing_fields.push("distrito");
  if (!parsed.concelho) missing_fields.push("concelho");
  if (!parsed.freguesia) missing_fields.push("freguesia");
  if (chosenArea == null) missing_fields.push("area");

  return {
    values: {
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
      area_bruta_m2: parsed.area_bruta_m2 ?? null,
      area_m2: chosenArea,
      area_terreno_m2: parsed.area_terreno_m2 ?? null,
      garagem: parsed.garagem ?? null,
      elevador: parsed.elevador ?? null,
      jardim: parsed.jardim ?? null,
      piscina: parsed.piscina ?? null,
    },
    missing_fields,
  };
}

export async function extractPropertyFromUrl(url: string) {
  const scrape = await firecrawlScrape(url);
  const publisherHtml = await fetchPublisherHtml(url);
  const markdown = (scrape.markdown ?? "").trim();
  const htmlText = stripHtml([publisherHtml, scrape.html].filter(Boolean).join("\n\n"));
  const content = [htmlText, markdown].filter(Boolean).join("\n\n").slice(0, 60000);
  if (!content) throw new Error("Não foi possível extrair conteúdo da página.");

  const sys = `És um assistente de mediação imobiliária em Portugal. Recebes o conteúdo de uma página de anúncio (Century 21, Idealista, Imovirtual, Casa Sapo, etc.).

Extrai APENAS os seguintes campos essenciais. Se algum não estiver claro, devolve null. NUNCA inventes.

Schema JSON:
{
  "referencia": string|null,           // ex: "C21-ABC123"
  "finalidade": "venda"|"arrendamento",
  "tipo_imovel": "apartamento"|"moradia"|"terreno"|"escritorio"|"loja"|"quinta"|"garagem"|"armazem"|"outro"|null,
  "tipologia": "T0"|"T1"|"T2"|"T3"|"T4"|"T5+"|"Moradia"|null,
  "subtipo_imovel": string|null,
  "preco": number|null,
  "distrito": string|null,
  "concelho": string|null,
  "freguesia": string|null,
  "zona": string|null,
  "area_util_m2": number|null,
  "area_bruta_m2": number|null,
  "area_terreno_m2": number|null,
  "garagem": boolean|null,
  "elevador": boolean|null,
  "jardim": boolean|null,
  "piscina": boolean|null
}

Century 21: no bloco "Detalhes", mantém "Área útil", "Área bruta" e "Área terreno" em campos separados. "Área bruta" NUNCA deve ser usada como "area_terreno_m2". Se a etiqueta "Área terreno" / "Área do lote" não existir, devolve area_terreno_m2 como null.
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
      { role: "user", content: `URL: ${url}\n\n${content}` },
    ],
  });

  let parsed: ParsedProperty;
  try {
    parsed = EssentialPropertySchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("A IA não conseguiu interpretar o anúncio. Adicione manualmente.");
  }

  return buildPropertyInsert(mergeStructuredAreas(parsed, publisherHtml ?? scrape.html));
}