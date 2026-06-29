import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callLovableAI } from "./ai-gateway.server";

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
  texto: z.string().min(10).max(50000),
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

    // 2. Ask AI to extract leads from pasted WhatsApp text
    const systemPrompt = `És um assistente especializado em mediação imobiliária em Portugal. Vais receber texto colado de conversas de grupos de WhatsApp.
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

    const raw = await callLovableAI({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: data.texto },
      ],
    });

    let parsed: { leads: Lead[] };
    try {
      parsed = LeadsResponseSchema.parse(JSON.parse(raw));
    } catch {
      parsed = { leads: [] };
    }

    // 3. Score matches client-side (deterministic)
    const matches = parsed.leads.map((lead) => {
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
