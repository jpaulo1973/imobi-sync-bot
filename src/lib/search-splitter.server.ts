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

/**
 * Detecta se um texto pode conter várias procuras independentes. Evita
 * chamadas IA quando é claramente uma procura única.
 */
export function mayContainMultipleSearches(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  let signals = 0;
  const intents = t.match(/procur[oa]|pretende\s+(comprar|arrendar|adquirir)|compra[dr]|arrendat[aá]rio|cliente\s+(pretende|procura|interess)|tenho\s+comprador/g);
  if (intents && intents.length >= 2) signals += 2;
  const budgets = t.match(/at[eé]\s*[\d.\s]{3,}\s*(€|eur|k|mil|000)?/g);
  if (budgets && budgets.length >= 2) signals += 2;
  // Múltiplas tipologias distintas na mesma frase (T2 e T3, T2 ou T4...)
  const tipologias = new Set((t.match(/\bt[0-6]\b/g) ?? []).map((x) => x.toLowerCase()));
  if (tipologias.size >= 2) signals += 2;
  // Bullets/numerados
  if (/(\n|^)\s*(\d+[).]|[-*•])\s+/g.test(t)) signals += 1;
  // Múltiplas zonas com preposição "em" seguido de nome próprio
  const enZonas = t.match(/\bem\s+[a-zçãáéíóú]{3,}/g);
  if (enZonas && enZonas.length >= 2) signals += 1;
  // Ligação explícita "outra procura" / "também"
  if (/(outra\s+procura|tamb[eé]m\s+procur|segunda\s+procura)/.test(t)) signals += 2;
  return signals >= 2;
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
Se o texto não descreve procura de comprador, devolve searches: [].`;

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
    return parsed.searches;
  } catch (e) {
    console.error("splitBuyerSearches failed", e);
    return [fallback];
  }
}