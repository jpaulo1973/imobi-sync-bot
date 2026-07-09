// Normalização inteligente de localidades PT via IA (Release 1.2, P2 #9).
// Chamada em lote no início de uma importação para não pagar 1x por linha.
import { callLovableAI } from "./ai-gateway.server";

/**
 * Recebe um conjunto de localidades brutas (ex.: "casc", "Lx", "Amadora ")
 * e devolve um mapping para a forma canónica portuguesa (ex.: "Cascais",
 * "Lisboa", "Amadora"). Em caso de ambiguidade, devolve o próprio valor
 * (sem tentar adivinhar) — preferimos preservar oportunidade a fundir mal.
 * Falhas de IA são silenciosas: devolve mapa vazio.
 */
export async function normalizeLocationsBatch(
  raw: Iterable<string | null | undefined>,
): Promise<Record<string, string>> {
  const clean = Array.from(new Set(Array.from(raw)
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length >= 2 && s.length <= 80)))
    .slice(0, 200); // hard cap
  if (clean.length === 0) return {};
  try {
    const prompt = `Estás a normalizar nomes de localidades portuguesas para uma base de dados imobiliária.
Para cada entrada, devolve a forma canónica (concelho/freguesia PT correta, com acentuação e capitalização adequada). Corrige erros ortográficos óbvios, expande abreviaturas comuns (ex.: "Lx"→"Lisboa"), remove ruído. Se a entrada for ambígua ou não corresponder a uma localidade PT reconhecível, mantém o valor original inalterado.

Entradas:
${clean.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Responde APENAS JSON no formato: {"map": {"<entrada>": "<canónico>", ...}}. Usa a entrada exatamente como recebida (mesmas maiúsculas/espaços) como chave.`;
    const raw = await callLovableAI({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "És um assistente que normaliza localidades portuguesas. Não inventes. Em caso de dúvida, devolve o valor original." },
        { role: "user", content: prompt },
      ],
    });
    const parsed = JSON.parse(raw) as { map?: Record<string, string> };
    const map = parsed.map ?? {};
    const out: Record<string, string> = {};
    for (const k of clean) {
      const v = typeof map[k] === "string" ? map[k].trim() : "";
      if (v && v.toLowerCase() !== k.toLowerCase()) out[k] = v;
    }
    return out;
  } catch (e) {
    console.warn("normalizeLocationsBatch fallback", e);
    return {};
  }
}