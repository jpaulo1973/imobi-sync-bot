import { callLovableAI } from "./ai-gateway.server";
import { z } from "zod";

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
  const intents = t.match(/procur[oa]|pretende\s+(comprar|arrendar|adquirir)|compra[dr]|arrendat[aá]rio|cliente\s+(pretende|procura|interess)/g);
  if (!intents || intents.length < 2) {
    // Também contamos múltiplos preços "até XXXX" como indicador
    const budgets = t.match(/at[eé]\s*[\d\.\s]{3,}/g);
    if (!budgets || budgets.length < 2) return false;
  }
  return true;
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