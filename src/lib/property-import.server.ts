import { z } from "zod";
import { callLovableAI } from "./ai-gateway.server";
import { LocationRepository } from "./geo/location-repository";
import { parseLocations } from "./geo";

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
  location_id?: string | null;
  geo_library_version?: number | null;
};

const MISSING_FIRECRAWL_KEY_MESSAGE = [
  "FIRECRAWL_API_KEY não configurado neste ambiente.",
  "• Deploy Lovable: liga o conector Firecrawl no projeto (Settings → Connectors) — a chave é injetada automaticamente no runtime servidor.",
  "• Deploy Vercel: os conectores da Lovable não são propagados. Adiciona manualmente a variável FIRECRAWL_API_KEY (valor fc-...) em Vercel → Project → Settings → Environment Variables (Production e Preview) e faz redeploy.",
].join("\n");

async function firecrawlScrape(url: string): Promise<{ markdown?: string; html?: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error(MISSING_FIRECRAWL_KEY_MESSAGE);
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

export const parsePtNumber = (raw: string): number | null => {
  const compact = raw.replace(/[\s\u00a0]/g, "");
  if (!compact) return null;

  let normalized: string;
  if (compact.includes(",")) {
    // Locale PT: pontos são milhares; a ÚLTIMA vírgula é o separador decimal.
    const noThousands = compact.replace(/\./g, "");
    const lastComma = noThousands.lastIndexOf(",");
    normalized =
      noThousands.slice(0, lastComma).replace(/,/g, "") + "." + noThousands.slice(lastComma + 1);
  } else if (/^\d+\.\d{1,2}$/.test(compact)) {
    // Um único ponto seguido de 1-2 dígitos → decimal (ex.: 143.45, 120.7).
    normalized = compact;
  } else {
    // Grupos de milhares (1.234, 1.234.567) ou formatos ambíguos.
    normalized = compact.replace(/\./g, "");
  }

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

/**
 * Sprint 1.2.2 — resolve o `location_id` canónico a partir dos campos
 * textuais extraídos pela IA, usando exclusivamente o parser único
 * (`parseLocations` sobre o snapshot do `LocationRepository`). Não
 * duplica lógica geográfica nem heurísticas próprias.
 *
 * Tenta do mais específico ao menos específico e devolve o primeiro
 * `location_id` resolvido. Se nada resolver, devolve `null` e o texto
 * tentado — o caller decide se sinaliza para revisão.
 */
export async function resolveLocationIdFromParsed(parsed: ParsedProperty): Promise<{
  location_id: string | null;
  geo_library_version: number;
  unresolved_text: string | null;
}> {
  const snap = await LocationRepository.getSnapshot();
  const candidates = (
    [
      [parsed.freguesia, "freguesia"],
      [parsed.concelho, "concelho"],
      [parsed.zona, "zona"],
      [parsed.distrito, "distrito"],
    ] as Array<[string | null | undefined, "freguesia" | "concelho" | "zona" | "distrito"]>
  )
    .map(([v, field]) => [(v ?? "").trim(), field] as const)
    .filter(([v]) => v.length > 0);
  for (const [text, field] of candidates) {
    const res = parseLocations(text, snap, { field });
    if (res.resolved.length > 0) {
      return { location_id: res.resolved[0], geo_library_version: snap.version, unresolved_text: null };
    }
  }
  return {
    location_id: null,
    geo_library_version: snap.version,
    unresolved_text: candidates[0]?.[0] ?? null,
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

  const merged = mergeStructuredAreas(parsed, publisherHtml ?? scrape.html);
  const built = buildPropertyInsert(merged);
  // Sprint 1.2.2: resolver location_id via parser único antes de devolver.
  const geo = await resolveLocationIdFromParsed(merged);
  const missing_fields = geo.location_id
    ? built.missing_fields
    : [...built.missing_fields, "location_id"];
  return {
    values: {
      ...built.values,
      location_id: geo.location_id,
      geo_library_version: geo.geo_library_version,
    },
    missing_fields,
  };
}

/**
 * Release 1.2.8 — reimportação por URL com upsert por (referencia, user_id).
 *
 * Campos que a fonte controla (sempre atualizados quando vêm preenchidos).
 * `preco` é sempre da fonte (mesmo que tenha sido editado à mão) por decisão
 * de negócio; os restantes só são escritos se a fonte devolver valor.
 */
export const IMPORT_UPDATABLE_FIELDS = [
  "finalidade",
  "tipo_imovel",
  "subtipo_imovel",
  "tipologia",
  "distrito",
  "concelho",
  "freguesia",
  "zona",
  "preco",
  "area_util_m2",
  "area_bruta_m2",
  "area_m2",
  "area_terreno_m2",
  "garagem",
  "elevador",
  "jardim",
  "piscina",
  "location_id",
  "geo_library_version",
] as const;

export type ImportUpdatableField = (typeof IMPORT_UPDATABLE_FIELDS)[number];

/**
 * Campos NUNCA tocados pela reimportação (gestão interna / texto humano):
 * referencia, user_id, created_at, ativo, descricao, caracteristicas,
 * categoria, estado.
 */
export type DiffValue = string | number | boolean | null;

export type PropertyFieldDiff = {
  field: ImportUpdatableField;
  current: DiffValue;
  next: DiffValue;
};

function isEmptyIncoming(field: ImportUpdatableField, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  // placeholders do extractor
  if (field === "tipologia" && typeof value === "string" && value.trim().toUpperCase() === "N/D") return true;
  if (field === "zona" && typeof value === "string" && value.trim().toLowerCase() === "n/d") return true;
  if (field === "preco" && typeof value === "number" && value <= 0) return true;
  return false;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") {
    const na = a === null || a === undefined ? null : Number(a);
    const nb = b === null || b === undefined ? null : Number(b);
    if (na === null || nb === null) return na === nb;
    return Math.abs(na - nb) < 0.005;
  }
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  return a === b;
}

/**
 * Calcula o conjunto mínimo de alterações entre o registo atual e os valores
 * extraídos da fonte. Não escreve nada — devolve o patch e o diff legível.
 */
export function buildPropertyUpdate(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): { patch: Record<string, unknown>; diff: PropertyFieldDiff[] } {
  const patch: Record<string, unknown> = {};
  const diff: PropertyFieldDiff[] = [];
  for (const field of IMPORT_UPDATABLE_FIELDS) {
    if (!(field in incoming)) continue;
    const next = incoming[field];
    if (isEmptyIncoming(field, next)) continue;
    const cur = current[field] ?? null;
    if (sameValue(cur, next)) continue;
    patch[field] = next;
    if (field !== "geo_library_version") diff.push({ field, current: cur as DiffValue, next: next as DiffValue });
  }
  return { patch, diff };
}