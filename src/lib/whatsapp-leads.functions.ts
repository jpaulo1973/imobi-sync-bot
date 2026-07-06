import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callLovableAI } from "./ai-gateway.server";

const QualifiedLeadSchema = z.object({
  nome: z.string().nullable().optional(),
  finalidade: z.enum(["venda", "arrendamento", "indefinido"]).default("indefinido"),
  tipo_imovel: z.array(z.string()).nullable().optional(),
  tipologia: z.string().nullable().optional(),
  zona: z.string().nullable().optional(),
  budget_min: z.number().nullable().optional(),
  budget_max: z.number().nullable().optional(),
  area_min: z.number().nullable().optional(),
  quartos_min: z.number().nullable().optional(),
  caracteristicas: z.array(z.string()).nullable().optional(),
  contacto: z.string().nullable().optional(),
  resumo: z.string(),
  mensagem_original: z.string().nullable().optional(),
  confianca: z.enum(["alta", "media", "baixa"]).default("media"),
});

export type QualifiedLead = z.infer<typeof QualifiedLeadSchema>;

const AnalysisResponse = z.object({
  total_capturas: z.number().default(0),
  leads: z.array(QualifiedLeadSchema),
});

const AnalyzeInput = z
  .object({
    texto: z.string().max(50000).optional().default(""),
    imagens: z.array(z.string().startsWith("data:image/")).max(20).optional().default([]),
  })
  .refine((v) => (v.texto?.trim().length ?? 0) >= 10 || (v.imagens?.length ?? 0) > 0, {
    message: "Forneça texto ou pelo menos uma imagem",
  });

export const analyzeWhatsappConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => AnalyzeInput.parse(data))
  .handler(async ({ data }) => {
    const systemPrompt = `És um consultor imobiliário experiente em Portugal a analisar conversas de grupos de WhatsApp entre consultores.

OBJECTIVO: identificar POTENCIAIS COMPRADORES ou ARRENDATÁRIOS (leads) — pessoas que PROCURAM imóvel. IGNORA ofertas de imóveis para venda/arrendamento, anúncios, partilhas de portais.

INSTRUÇÕES:
1. Se receberes várias imagens, trata-as como uma única conversa contínua na ordem dada. Agrupa mensagens do mesmo pedido antes de decidir.
2. Interpreta a INTENÇÃO, não apenas palavras exactas. Expressões como "procuro", "tenho comprador", "cliente aprovado para crédito", "casal procura", "família precisa", "alguém tem", "necessito de", "compra urgente", "pretende arrendar" etc. sinalizam leads.
3. IGNORA: cabeçalhos WhatsApp (hora, "online", "digitando"), emojis isolados, reações, mensagens repetidas, assinaturas, saudações, ofertas de imóveis.
4. Para CADA lead identificada extrai:
   - nome: nome do cliente/família se referido (ou null; não é o nome de quem envia a mensagem)
   - finalidade: "venda" (comprar) | "arrendamento" (arrendar) | "indefinido"
   - tipo_imovel: array com "Apartamento","Moradia","Terreno","Loja","Escritório","Armazém","Prédio","Espaço comercial" (ou null)
   - tipologia: "T0","T1","T2","T3","T4","T5+" (ou null)
   - zona: cidade/concelho/zona/freguesia (ou null)
   - budget_min / budget_max: em euros como número (ou null). Para arrendamento é mensalidade.
   - area_min: m² mínimos (ou null)
   - quartos_min: número mínimo de quartos (ou null)
   - caracteristicas: array curto com extras relevantes ("garagem","elevador","piscina","jardim","varanda") (ou null)
   - contacto: telefone/consultor que trouxe a lead (ou null)
   - resumo: 1 frase concisa a descrever o pedido
   - mensagem_original: excerto (máx 300 caracteres) que originou a lead
   - confianca: "alta" (pedido claro com finalidade+zona+outro critério), "media" (razoavelmente claro), "baixa" (pedido ambíguo ou dados insuficientes)
5. Se não houver leads, devolve leads:[].
6. Não inventes dados. Campo desconhecido = null.

RESPOSTA: APENAS JSON válido no formato:
{"total_capturas": <número de imagens analisadas>, "leads": [ ... ]}`;

    const userContent: Array<
      { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
    > = [];
    if (data.texto && data.texto.trim().length > 0) {
      userContent.push({ type: "text", text: `Texto adicional colado pelo consultor:\n${data.texto}` });
    }
    const imgs = data.imagens ?? [];
    if (imgs.length > 0) {
      userContent.push({
        type: "text",
        text: `A seguir ${imgs.length} captura(s) de ecrã de conversas WhatsApp, pela ordem em que foram carregadas. Trata-as como uma única conversa contínua.`,
      });
      for (const img of imgs) {
        userContent.push({ type: "image_url", image_url: { url: img } });
      }
    }
    if (userContent.length === 0) userContent.push({ type: "text", text: "" });

    const raw = await callLovableAI({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    let parsed: z.infer<typeof AnalysisResponse>;
    try {
      parsed = AnalysisResponse.parse(JSON.parse(raw));
    } catch {
      parsed = { total_capturas: imgs.length, leads: [] };
    }
    if (!parsed.total_capturas) parsed.total_capturas = imgs.length;
    return parsed;
  });

const LeadToCreate = QualifiedLeadSchema.extend({
  telefone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
});

const CreateInput = z.object({
  leads: z.array(LeadToCreate).min(1).max(50),
});

export const createBuyersFromLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CreateInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const rows = data.leads.map((l) => {
      const nome = (l.nome && l.nome.trim()) || (l.resumo ? l.resumo.slice(0, 60) : "Lead WhatsApp");
      const finalidade = l.finalidade === "indefinido" ? "venda" : l.finalidade;
      const notasParts: string[] = [];
      if (l.notas) notasParts.push(l.notas);
      if (l.caracteristicas && l.caracteristicas.length > 0)
        notasParts.push(`Características: ${l.caracteristicas.join(", ")}`);
      if (l.mensagem_original) notasParts.push(`Origem WhatsApp: "${l.mensagem_original}"`);
      if (l.contacto) notasParts.push(`Contacto/origem: ${l.contacto}`);
      return {
        user_id: userId,
        nome,
        telefone: l.telefone ?? null,
        email: l.email ?? null,
        finalidade,
        tipologia: l.tipologia ?? null,
        zona: l.zona ?? null,
        tipo_imovel: l.tipo_imovel ?? null,
        budget_min: l.budget_min ?? null,
        budget_max: l.budget_max ?? null,
        area_min: l.area_min ?? null,
        quartos_min: l.quartos_min ?? null,
        garagem_obrigatoria: (l.caracteristicas ?? []).some((c) => /garagem/i.test(c)),
        elevador_obrigatorio: (l.caracteristicas ?? []).some((c) => /elevador/i.test(c)),
        notas: notasParts.join("\n") || null,
        ativo: true,
      };
    });
    const { data: inserted, error } = await supabase.from("buyer_clients").insert(rows).select();
    if (error) throw new Error(error.message);
    return { inserted: inserted?.length ?? 0 };
  });