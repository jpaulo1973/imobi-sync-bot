import { callLovableAI } from "./ai-gateway.server";
import { z } from "zod";

// Release 1.2 — critério de proximidade estruturado (não valida tempos).
export const ProximitySchema = z.object({
  poi: z.string(),
  minutes: z.number().int().positive(),
});
export type ProximityCriterion = z.infer<typeof ProximitySchema>;

// Estrutura de UMA procura independente devolvida pela IA.
// Cada campo é opcional e independente: NUNCA misturar critérios entre procuras.
export const SplitSearchSchema = z.object({
  finalidade: z.enum(["venda", "arrendamento", "indefinido"]).default("indefinido"),
  tipo_imovel: z.array(z.string()).nullable().optional(),
  tipologia: z.string().nullable().optional(),
  zona: z.string().nullable().optional(),
  freguesia: z.string().nullable().optional(),
  municipio: z.string().nullable().optional(),
  budget_min: z.number().nullable().optional(),
  budget_max: z.number().nullable().optional(),
  area_min: z.number().nullable().optional(),
  quartos_min: z.number().nullable().optional(),
  caracteristicas: z.array(z.string()).nullable().optional(),
  resumo: z.string().nullable().optional(),
  proximity: z.array(ProximitySchema).nullable().optional(),
});
export type SplitSearch = z.infer<typeof SplitSearchSchema>;

const Response = z.object({ searches: z.array(SplitSearchSchema) });

// -------------------------------------------------------------------------
// Grounding: garante que zona/municipio/freguesia produzidos pelo splitter
// aparecem efetivamente no texto original do consultor. Impede o LLM de
// inventar zonas funcionais (ex.: "Margem Sul" a partir de "Almada-Amora")
// que depois seriam resolvidas pelo motor e gerariam matches em freguesias
// não pedidas (ex.: Azeitão). Regra: se o token não estiver presente no
// texto — comparação sem acentos/case — é descartado.
// -------------------------------------------------------------------------
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function foldForMatch(s: string): string {
  return stripAccents(s).toLowerCase();
}
function textContainsToken(haystack: string, token: string): boolean {
  const h = foldForMatch(haystack);
  // Considera qualquer segmento separado por vírgula/barra/hífen/"ou"/"e".
  const parts = foldForMatch(token)
    .split(/[,/;]|\s+ou\s+|\s+e\s+|\s+-\s+|-/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  if (parts.length === 0) return false;
  // Basta que UM dos segmentos apareça no texto — se nenhum aparece a
  // localização é hallucination do LLM.
  return parts.some((p) => h.includes(p));
}
export function groundLocationsInText(sp: SplitSearch, rawText: string): SplitSearch {
  const out: SplitSearch = { ...sp };
  for (const field of ["zona", "municipio", "freguesia"] as const) {
    const v = out[field];
    if (typeof v === "string" && v.trim().length > 0) {
      if (!textContainsToken(rawText, v)) {
        out[field] = null;
      }
    }
  }
  return out;
}

/**
 * Detecta se um texto pode conter várias procuras independentes. Evita
 * chamadas IA quando é claramente uma procura única.
 *
 * Objetivo: **minimizar falsos positivos**. O LLM só deve ser chamado
 * quando há evidência forte de múltiplas procuras INDEPENDENTES no mesmo
 * texto. Regras (basta uma dispara, exceto a combinatorial que exige 2+
 * dimensões a variar):
 *
 *  A) Marcador explícito de segunda procura ("outra procura", "segunda
 *     procura", "também procura", "outro comprador/cliente", "tenho
 *     também um comprador para…"). Um único marcador basta.
 *  B) Lista bullet/numerada com **2 ou mais** itens em linhas separadas.
 *  C) Combinatorial: 2 ou mais dimensões independentes variam ao mesmo
 *     tempo — tipologias distintas (≥2), budgets distintos (≥2), ou
 *     intents distintos (≥2). Uma só dimensão a variar (ex.: "T2 ou T3")
 *     NÃO justifica LLM.
 *
 * Textos muito curtos (<40 caracteres) e ausência total dos sinais acima
 * devolvem false, sem chamada IA.
 */
export function mayContainMultipleSearches(text: string | null | undefined): boolean {
  if (!text) return false;
  if (text.length < 40) return false;
  const t = text.toLowerCase();

  // (A) Marcador explícito de múltiplas procuras — dispara sozinho.
  if (
    /(outra\s+procura|segunda\s+procura|tamb[eé]m\s+procur|outro\s+comprador|outro\s+cliente|tenho\s+(tamb[eé]m|ainda)\s+(um\s+|outro\s+)?(comprador|cliente))/.test(
      t,
    )
  ) {
    return true;
  }

  // (B) Lista bullet/numerada com 2+ itens em linhas separadas.
  const bulletLines = (text.match(/(?:^|\n)\s*(?:\d+[).]|[-*•])\s+\S/g) ?? []).length;
  if (bulletLines >= 2) return true;

  // (C) Combinatorial: 2+ dimensões independentes variam em simultâneo.
  const tipologias = new Set((t.match(/\bt[0-6]\b/g) ?? []).map((x) => x.toLowerCase()));
  const budgets = (t.match(/at[eé]\s*\d[\d.\s]{2,}\s*(?:€|eur|k|mil)/g) ?? []).length;
  const intents = (
    t.match(/procur[oa]\s|pretende\s+(?:comprar|arrendar|adquirir)|tenho\s+comprador\s+para|cliente\s+(?:pretende|procura|interess)/g) ?? []
  ).length;

  let dims = 0;
  if (tipologias.size >= 2) dims++;
  if (budgets >= 2) dims++;
  if (intents >= 2) dims++;
  return dims >= 2;
}

// -------------------------------------------------------------------------
// Parser determinístico de critérios de proximidade
// (ex.: "até 20 minutos do aeroporto", "a 30 min do centro de lisboa").
// Mapeia POIs conhecidos para slugs estáveis.
// -------------------------------------------------------------------------

const POI_MAP: Array<{ slug: string; patterns: RegExp[] }> = [
  {
    slug: "aeroporto_lisboa",
    patterns: [/aeroporto\s+(de\s+)?lisboa/i, /aeroporto\s+humberto\s+delgado/i, /^aeroporto$/i],
  },
  {
    slug: "aeroporto_porto",
    patterns: [/aeroporto\s+(do\s+)?porto/i, /aeroporto\s+sa\s+carneiro/i, /aeroporto\s+francisco\s+sa\s+carneiro/i],
  },
  {
    slug: "centro_lisboa",
    patterns: [/centro\s+de\s+lisboa/i, /baixa\s+de\s+lisboa/i, /lisboa\s+centro/i],
  },
  {
    slug: "centro_porto",
    patterns: [/centro\s+do\s+porto/i, /baixa\s+do\s+porto/i, /porto\s+centro/i],
  },
];

function detectPoi(fragment: string): string | null {
  for (const p of POI_MAP) {
    if (p.patterns.some((r) => r.test(fragment))) return p.slug;
  }
  return null;
}

export function extractProximityCriteria(text: string | null | undefined): ProximityCriterion[] {
  if (!text) return [];
  const results: ProximityCriterion[] = [];
  const re = /(?:at[eé]|a)\s+(\d{1,3})\s*min(?:utos)?\s+(?:do|da|de|dos|das)\s+([a-zçãáéíóúâêô\s]{3,60})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const minutes = Number(m[1]);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 180) continue;
    const rawPoi = m[2].trim().replace(/[.,;].*$/, "").trim();
    const poi = detectPoi(rawPoi);
    if (!poi) continue;
    if (results.some((r) => r.poi === poi && r.minutes === minutes)) continue;
    results.push({ poi, minutes });
  }
  return results;
}

/**
 * Pede à IA para separar um texto em N procuras independentes.
 * Em falha devolve um único item derivado do fallback.
 */
export async function splitBuyerSearches(text: string, fallback: SplitSearch): Promise<SplitSearch[]> {
  if (!mayContainMultipleSearches(text)) return [fallback];

  const system = `És um assistente que separa pedidos de compradores imobiliários.
Recebes um texto que PODE conter várias procuras INDEPENDENTES (diferentes tipologias, zonas ou orçamentos).
Devolve APENAS JSON válido: {"searches": [{...},{...}]}
Cada objeto representa UMA procura completamente independente. NUNCA misturar critérios entre procuras.
Campos por procura (todos opcionais, null se desconhecido):
- finalidade: "venda" | "arrendamento" | "indefinido"
- tipo_imovel: array ["Apartamento","Moradia","Terreno","Loja","Escritório","Armazém","Prédio","Espaço comercial"]
- tipologia: "T0"|"T1"|"T2"|"T3"|"T4"|"T5+" (se for "T2 ou T3" devolve como "T2" e cria SEGUNDA entrada para T3, OU escolhe a menor)
- zona: cidade/concelho/freguesia
- budget_min / budget_max: euros (número)
- area_min: m² mínimos
- quartos_min: número
- caracteristicas: array curto
- resumo: 1 frase
Se só existir 1 procura, devolve searches com 1 elemento.
Se o texto não descreve procura de comprador, devolve searches: [].

REGRAS DE LOCALIZAÇÃO (obrigatórias):
- Usa APENAS nomes de localidades EXPLICITAMENTE mencionados no texto. Não inventes, não expandas, não generalizes.
- É PROIBIDO devolver zonas funcionais ou regiões macro (ex.: "Margem Sul", "Grande Lisboa", "Linha de Cascais", "Área Metropolitana", "Zona Norte") a menos que essas expressões apareçam literalmente no texto.
- Se o texto disser "Almada-Amora" ou "Almada/Amora", trata como duas localidades independentes (Almada e Amora) — NUNCA como uma região agregadora.
- Se não houver localização clara, devolve null.`;

  try {
    const raw = await callLovableAI({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
    });
    const parsed = Response.parse(JSON.parse(raw));
    if (!parsed.searches.length) return [fallback];
    // Post-processing determinístico: descarta zonas que o LLM inventou.
    return parsed.searches.map((s) => groundLocationsInText(s, text));
  } catch (e) {
    console.error("splitBuyerSearches failed", e);
    return [fallback];
  }
}