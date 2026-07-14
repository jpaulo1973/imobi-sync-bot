import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callLovableAI } from "./ai-gateway.server";
import {
  evaluateSearchAcceptance,
  hasStructuredCriteria,
  type AcceptanceDecision,
} from "./search-acceptance";

const LeadSchema = z.object({
  finalidade: z.enum(["venda", "arrendamento", "indefinido"]).default("indefinido"),
  tipologia: z.string().nullable().optional(),
  zona: z.string().nullable().optional(),
  preco_max: z.number().nullable().optional(),
  preco_min: z.number().nullable().optional(),
  quartos: z.number().nullable().optional(),
  contacto: z.string().nullable().optional(),
  resumo: z.string(),
  mensagem_original: z.string(),
});

const LeadsResponseSchema = z.object({
  leads: z.array(LeadSchema),
});

export type Lead = z.infer<typeof LeadSchema>;

const InputSchema = z.object({
  texto: z.string().max(50000).optional().default(""),
  imagens: z.array(z.string().startsWith("data:image/")).max(10).optional().default([]),
}).refine((v) => (v.texto?.trim().length ?? 0) >= 10 || (v.imagens?.length ?? 0) > 0, {
  message: "Forneça texto ou pelo menos uma imagem",
});

export const extractAndMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Get properties for the user
    const { data: properties, error: propErr } = await supabase
      .from("properties")
      .select("*")
      .eq("user_id", userId)
      .eq("ativo", true);
    if (propErr) throw new Error(propErr.message);

    // 2. Ask AI to extract leads from pasted WhatsApp text and/or screenshots
    const systemPrompt = `És um assistente especializado em mediação imobiliária em Portugal. Vais receber texto colado e/ou capturas de ecrã (screenshots) de conversas de grupos de WhatsApp.
Se receberes imagens, faz OCR e lê cuidadosamente cada balão de mensagem, incluindo nome do remetente quando visível.
A tua tarefa: identificar PEDIDOS de quem PROCURA imóvel (leads / compradores / arrendatários) — IGNORA mensagens que oferecem imóveis para venda/arrendamento.

Para cada lead, extrai:
- finalidade: "venda" se quer comprar, "arrendamento" se quer arrendar, "indefinido" se não for claro
- tipologia: ex "T1","T2","T3","T4","T5","moradia" (ou null)
- zona: cidade/zona/bairro mencionado (ou null)
- preco_max: orçamento máximo em euros como número (ou null)
- preco_min: orçamento mínimo em euros como número (ou null)
- quartos: número de quartos (ou null)
- contacto: telefone/nome se mencionado (ou null)
- resumo: 1 frase curta a descrever o pedido
- mensagem_original: a mensagem original (cortada a 300 caracteres)

Responde APENAS com JSON válido no formato: {"leads":[...]}.
Se não houver leads, devolve {"leads":[]}.`;

    const userContent: Array<
      { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
    > = [];
    if (data.texto && data.texto.trim().length > 0) {
      userContent.push({ type: "text", text: data.texto });
    }
    for (const img of data.imagens ?? []) {
      userContent.push({ type: "image_url", image_url: { url: img } });
    }
    if (userContent.length === 0) {
      userContent.push({ type: "text", text: "" });
    }

    const raw = await callLovableAI({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    let parsed: { leads: Lead[] };
    try {
      parsed = LeadsResponseSchema.parse(JSON.parse(raw));
    } catch {
      parsed = { leads: [] };
    }

    // Aceitação centralizada — o LLM só extrai; a decisão vive em
    // src/lib/search-acceptance.ts. Anúncios descartados, resto anotado.
    const acceptedLeads: Array<Lead & { acceptance: AcceptanceDecision }> = [];
    for (const lead of parsed.leads) {
      const decision = evaluateSearchAcceptance({
        text: lead.mensagem_original ?? lead.resumo ?? null,
        finalidade: lead.finalidade,
        hasStructured: hasStructuredCriteria({
          finalidade: lead.finalidade,
          tipologia: lead.tipologia,
          zona: lead.zona,
          budget_min: lead.preco_min ?? null,
          budget_max: lead.preco_max ?? null,
        }),
      });
      if (decision.kind === "anuncio") continue;
      acceptedLeads.push({ ...lead, acceptance: decision });
    }

    // 3. Score matches client-side (deterministic)
    const matches = acceptedLeads.map((lead) => {
      const ranked = (properties ?? [])
        .map((p) => {
          let score = 0;
          const reasons: string[] = [];

          if (lead.finalidade !== "indefinido" && p.finalidade === lead.finalidade) {
            score += 40;
            reasons.push(`Finalidade ${p.finalidade}`);
          } else if (lead.finalidade !== "indefinido" && p.finalidade !== lead.finalidade) {
            score -= 50;
          }

          if (lead.tipologia && p.tipologia.toLowerCase().includes(lead.tipologia.toLowerCase())) {
            score += 25;
            reasons.push(`Tipologia ${p.tipologia}`);
          }

          if (lead.zona) {
            const z = lead.zona.toLowerCase();
            if (p.zona.toLowerCase().includes(z) || (p.concelho ?? "").toLowerCase().includes(z)) {
              score += 25;
              reasons.push(`Zona ${p.zona}`);
            }
          }

          if (lead.preco_max && Number(p.preco) <= lead.preco_max) {
            score += 15;
            reasons.push(`Dentro do orçamento`);
          } else if (lead.preco_max && Number(p.preco) > lead.preco_max * 1.15) {
            score -= 20;
          }

          if (lead.quartos && p.quartos === lead.quartos) {
            score += 10;
            reasons.push(`${p.quartos} quartos`);
          }

          return { property: p, score, reasons };
        })
        .filter((m) => m.score > 20)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      return { lead, matches: ranked };
    });

    return { results: matches, totalLeads: parsed.leads.length };
  });
