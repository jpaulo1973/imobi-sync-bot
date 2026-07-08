// Arbitragem por IA para decidir se duas procuras com similaridade
// intermédia (80-94%) representam a mesma necessidade ou não.
//
// Este ficheiro é `*.server.ts` — só pode ser importado dentro de handlers
// de server functions (via `await import`), nunca no bundle client.

import { callLovableAI } from "./ai-gateway.server";

export type AiArbiterSide = {
  criteria: Record<string, unknown>;
  texto: string | null;
  nome: string | null;
};

export type AiArbiterInput = {
  incoming: AiArbiterSide;
  candidate: AiArbiterSide;
  ruleScore: number;
};

export type AiArbiterDecision = "update" | "new" | "review";
export type AiArbiterResult = { decision: AiArbiterDecision; reason: string };

const SYS = `És um classificador de procuras imobiliárias em Portugal. Recebes duas procuras (uma existente e uma nova) e decides se representam a MESMA necessidade de compra ou NECESSIDADES DIFERENTES.

Regras absolutas:
- O mesmo telefone/consultor representa frequentemente vários compradores diferentes. NUNCA junta procuras só porque o telefone é o mesmo.
- FUNDIR ("update") apenas quando a necessidade é claramente a mesma: mesmo tipo de operação, tipologia compatível, localização compatível e orçamento compatível.
- MANTER SEPARADAS ("new") quando tipologia, localização, tipo de imóvel ou orçamento diferem de forma relevante.
- Em caso de dúvida razoável, escolhe "review" (cria como nova mas fica marcada para revisão manual).
- Preservar oportunidades de negócio > eliminar duplicados.

Responde APENAS em JSON válido: {"decision":"update"|"new"|"review","reason":"..."} com uma justificação curta em português.`;

export async function aiArbitrateDedup(input: AiArbiterInput): Promise<AiArbiterResult> {
  const trim = (s: string | null | undefined, n = 400) =>
    s ? s.slice(0, n) : "";

  const payload = {
    rule_similarity_percent: input.ruleScore,
    existing: {
      nome: input.candidate.nome,
      criteria: input.candidate.criteria,
      texto: trim(input.candidate.texto),
    },
    incoming: {
      nome: input.incoming.nome,
      criteria: input.incoming.criteria,
      texto: trim(input.incoming.texto),
    },
  };

  try {
    const raw = await callLovableAI({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(raw) as { decision?: string; reason?: string };
    const dec: AiArbiterDecision =
      parsed.decision === "update" || parsed.decision === "new"
        ? parsed.decision
        : "review";
    return { decision: dec, reason: String(parsed.reason ?? "").slice(0, 500) };
  } catch (e) {
    // Regra de segurança: em falha da IA → criar como nova.
    return {
      decision: "new",
      reason: `IA indisponível (${e instanceof Error ? e.message : "erro"}) — mantida separada por segurança`,
    };
  }
}