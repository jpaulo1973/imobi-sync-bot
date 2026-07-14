import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callLovableAI } from "./ai-gateway.server";
import { scoreMatch, type MatchCategoryResult } from "./matching-engine";
import { normalizePhone } from "./dedup";
import {
  evaluateSearchAcceptance,
  hasStructuredCriteria,
  type AcceptanceDecision,
} from "./search-acceptance";
import { normalizeSearchBedrooms } from "./bedrooms-normalize";

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
  telefone: z.string().nullable().optional(),
  grupo_whatsapp: z.string().nullable().optional(),
  data_publicacao: z.string().nullable().optional(),
  resumo: z.string(),
  mensagem_original: z.string().nullable().optional(),
  confianca: z.enum(["alta", "media", "baixa"]).default("media"),
});

export type QualifiedLead = z.infer<typeof QualifiedLeadSchema>;

// Lead enriquecido com a decisão do módulo central de aceitação. Nenhum
// consumidor deve inferir aceitação a partir do LLM — usa `acceptance`.
export type QualifiedLeadWithAcceptance = QualifiedLead & {
  acceptance: AcceptanceDecision;
};

// Aplica o decisor único a cada lead extraído pelo LLM. Descarta anúncios
// e devolve leads com decisão anotada (aceite/revisao). O LLM só extrai —
// a aceitação vive em src/lib/search-acceptance.ts.
function applyAcceptance(leads: QualifiedLead[]): QualifiedLeadWithAcceptance[] {
  const out: QualifiedLeadWithAcceptance[] = [];
  for (const l of leads) {
    const decision = evaluateSearchAcceptance({
      text: l.mensagem_original ?? l.resumo ?? null,
      finalidade: l.finalidade,
      hasStructured: hasStructuredCriteria({
        finalidade: l.finalidade,
        tipologia: l.tipologia,
        tipo_imovel: l.tipo_imovel,
        zona: l.zona,
        budget_min: l.budget_min,
        budget_max: l.budget_max,
        area_min: l.area_min,
      }),
    });
    if (decision.kind === "anuncio") continue;
    out.push({ ...l, acceptance: decision });
  }
  return out;
}

const AnalysisResponse = z.object({
  total_capturas: z.number().default(0),
  leads: z.array(QualifiedLeadSchema),
});

// Erro dedicado a falhas de extração/parse da resposta do LLM.
// Distingue explicitamente:
//   - "IA não devolveu procuras" (leads: [] no JSON válido) ⇒ NÃO lança.
//   - "IA devolveu algo mas não é interpretável" ⇒ lança este erro.
// A UI apanha `WHATSAPP_PARSE_ERROR` e mostra uma mensagem distinta.
export class WhatsappParseError extends Error {
  code = "WHATSAPP_PARSE_ERROR" as const;
  constructor(
    message: string,
    public readonly detail: {
      execution_id: string;
      error_type: "JSON_PARSE" | "ZOD_VALIDATION" | "EMPTY_RESPONSE";
      raw_excerpt: string;
      failed_fields?: Array<{ path: string; message: string; code: string }>;
      cause_message: string;
    },
  ) {
    super(message);
    this.name = "WhatsappParseError";
  }
}

// Parser único da resposta do LLM. Nunca engole erros — regista telemetria
// estruturada e lança `WhatsappParseError` para o handler decidir.
function parseLlmAnalysisResponse(
  raw: string,
  ctx: { execution_id: string; source: "analyze" | "match"; total_capturas: number },
): z.infer<typeof AnalysisResponse> {
  const rawExcerpt = (raw ?? "").slice(0, 1000);

  if (!raw || raw.trim().length === 0) {
    const detail = {
      execution_id: ctx.execution_id,
      error_type: "EMPTY_RESPONSE" as const,
      raw_excerpt: rawExcerpt,
      cause_message: "LLM devolveu resposta vazia",
    };
    console.error("[whatsapp-leads] LLM_PARSING_FAILURE", { source: ctx.source, ...detail });
    throw new WhatsappParseError("A IA devolveu uma resposta vazia.", detail);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    const detail = {
      execution_id: ctx.execution_id,
      error_type: "JSON_PARSE" as const,
      raw_excerpt: rawExcerpt,
      cause_message: e instanceof Error ? e.message : String(e),
    };
    console.error("[whatsapp-leads] LLM_PARSING_FAILURE", { source: ctx.source, ...detail });
    throw new WhatsappParseError(
      "A IA devolveu uma resposta que não é JSON válido.",
      detail,
    );
  }

  const zres = AnalysisResponse.safeParse(json);
  if (!zres.success) {
    const failed_fields = zres.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
      code: i.code,
    }));
    const detail = {
      execution_id: ctx.execution_id,
      error_type: "ZOD_VALIDATION" as const,
      raw_excerpt: rawExcerpt,
      failed_fields,
      cause_message: zres.error.message,
    };
    console.error("[whatsapp-leads] LLM_PARSING_FAILURE", { source: ctx.source, ...detail });
    throw new WhatsappParseError(
      "A IA devolveu dados que não cumprem o formato esperado.",
      detail,
    );
  }

  const out = zres.data;
  if (!out.total_capturas) out.total_capturas = ctx.total_capturas;
  return out;
}

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
4. SEPARAÇÃO DE PROCURAS: se UMA mensagem contém várias procuras INDEPENDENTES (diferentes tipologias, zonas ou orçamentos), cria UM lead separado por cada procura. NUNCA mistures critérios entre procuras diferentes.
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

    const parsed = parseLlmAnalysisResponse(raw, {
      execution_id: crypto.randomUUID(),
      source: "analyze",
      total_capturas: imgs.length,
    });
    return { ...parsed, leads: applyAcceptance(parsed.leads) };
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
      const bed = normalizeSearchBedrooms(
        { tipologia: l.tipologia, quartos_min: l.quartos_min },
        "whatsapp:createBuyers",
      );
      return {
        user_id: userId,
        nome,
        telefone: normalizePhone(l.telefone) ?? null,
        email: l.email ?? null,
        finalidade,
        tipologia: bed.tipologia,
        zona: l.zona ?? null,
        tipo_imovel: l.tipo_imovel ?? null,
        budget_min: l.budget_min ?? null,
        budget_max: l.budget_max ?? null,
        area_min: l.area_min ?? null,
        quartos_min: bed.quartos_min,
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

// ---------------------------------------------------------------------------
// Property Match a partir de conversas de WhatsApp.
//
// Este é o entry point principal do módulo WhatsApp: recebe texto/capturas,
// interpreta o pedido do comprador e devolve imediatamente os imóveis
// compatíveis da carteira do utilizador. A criação de lead é opcional e
// vive noutra server fn (createBuyersFromLeads acima).
// ---------------------------------------------------------------------------

function leadToBuyer(l: QualifiedLead) {
  const finalidade = l.finalidade === "indefinido" ? undefined : l.finalidade;
  const gar = (l.caracteristicas ?? []).some((c) => /garagem/i.test(c));
  const ele = (l.caracteristicas ?? []).some((c) => /elevador/i.test(c));
  const bed = normalizeSearchBedrooms(
    { tipologia: l.tipologia, quartos_min: l.quartos_min },
    "whatsapp:leadToBuyer",
  );
  return {
    finalidade,
    tipo_imovel: l.tipo_imovel ?? null,
    tipologia: bed.tipologia,
    zona: l.zona ?? null,
    budget_min: l.budget_min ?? null,
    budget_max: l.budget_max ?? null,
    area_min: l.area_min ?? null,
    quartos_min: bed.quartos_min,
    garagem_obrigatoria: gar,
    elevador_obrigatorio: ele,
  };
}

export type PropertyMatchResult = {
  property: {
    id: string;
    referencia: string | null;
    tipo_imovel: string | null;
    tipologia: string | null;
    zona: string | null;
    freguesia: string | null;
    concelho: string | null;
    preco: number | null;
    quartos: number | null;
    area_util_m2: number | null;
    finalidade: string | null;
  };
  score: number;
  reasons: string[];
  categories: MatchCategoryResult[];
};

export type LeadMatchResult = {
  lead: QualifiedLeadWithAcceptance;
  matches: PropertyMatchResult[];
};

export const matchWhatsappConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => AnalyzeInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1) Interpretar conversa via IA — reutiliza o mesmo prompt.
    const systemPrompt = `És um consultor imobiliário experiente em Portugal a analisar conversas de grupos de WhatsApp entre consultores.

OBJECTIVO: identificar POTENCIAIS COMPRADORES ou ARRENDATÁRIOS — pessoas que PROCURAM imóvel. IGNORA ofertas de imóveis para venda/arrendamento, anúncios, partilhas de portais.

Interpreta a INTENÇÃO. Ignora cabeçalhos WhatsApp, emojis isolados, reações. Se receberes várias imagens, trata-as como uma única conversa contínua.

IMPORTANTE — SEPARAÇÃO DE PROCURAS: Se UMA única mensagem contém várias procuras INDEPENDENTES (por exemplo tipologias, zonas ou orçamentos diferentes na mesma frase — "procura T2 até 400k. Procura moradia em Cascais até 1M. Procura apartamento na Lourinhã"), cria UM lead separado por cada procura. NUNCA mistures zona, tipologia ou orçamento entre procuras diferentes.

Para CADA pedido identificado extrai: nome (do consultor ou cliente que envia o pedido, quando existir), finalidade (venda|arrendamento|indefinido), tipo_imovel (array), tipologia, zona, budget_min, budget_max, area_min, quartos_min, caracteristicas (array), contacto, telefone (número em formato português, apenas dígitos com prefixo se aplicável), grupo_whatsapp (nome do grupo WhatsApp visível no cabeçalho da conversa quando existir), data_publicacao (data ISO da mensagem quando visível), resumo (1 frase), mensagem_original (excerto ≤300 char), confianca (alta|media|baixa). Não inventes dados: desconhecido = null.

RESPOSTA: APENAS JSON válido:
{"total_capturas": <n>, "leads": [ ... ]}`;

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
        text: `A seguir ${imgs.length} captura(s) de ecrã. Trata-as como uma única conversa contínua.`,
      });
      for (const img of imgs) userContent.push({ type: "image_url", image_url: { url: img } });
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

    const parsed = parseLlmAnalysisResponse(raw, {
      execution_id: crypto.randomUUID(),
      source: "match",
      total_capturas: imgs.length,
    });

    // Aceitação centralizada — descarta anúncios, anota revisão vs aceite.
    const acceptedLeads = applyAcceptance(parsed.leads);

    // 2) Ir buscar a carteira do utilizador (só imóveis ativos).
    const { data: properties, error: pErr } = await supabase
      .from("properties")
      .select(
        "id, referencia, tipo_imovel, tipologia, distrito, concelho, freguesia, zona, preco, area_util_m2, area_m2, area_terreno_m2, quartos, garagem, elevador, jardim, piscina, finalidade, location_id",
      )
      .eq("user_id", userId)
      .eq("ativo", true);
    if (pErr) throw new Error(pErr.message);

    // Fase 3 — motor puro por IDs. Resolvemos a zona textual do lead através
    // do LocationRepository antes de correr o motor. Leads cujo texto não
    // resolva ficam com location_ids=[] e não geram matches (pending_geo).
    const { LocationRepository, parseLocations } = await import("./geo");
    const { buildGeoMatchIndex } = await import("./matching-engine");
    const snap = await LocationRepository.getSnapshot();
    const geoIndex = buildGeoMatchIndex(snap);

    // 3) Para cada lead ACEITE, correr o motor contra toda a carteira. Leads
    //    em revisão continuam a devolver os melhores matches para o consultor
    //    poder decidir manualmente; anúncios já foram filtrados.
    const results: LeadMatchResult[] = acceptedLeads.map((lead) => {
      const location_ids = lead.zona ? parseLocations(lead.zona, snap).resolved : [];
      const buyer = { ...leadToBuyer(lead), location_ids };
      const scored = (properties ?? [])
        .map((p) => ({ p, s: scoreMatch(buyer, p, { geoIndex }) }))
        .filter((x) => x.s.compatible)
        .sort((a, b) => b.s.score - a.s.score)
        .slice(0, 10)
        .map(({ p, s }) => ({
          property: {
            id: p.id,
            referencia: p.referencia ?? null,
            tipo_imovel: p.tipo_imovel ?? null,
            tipologia: p.tipologia ?? null,
            zona: p.zona ?? null,
            freguesia: p.freguesia ?? null,
            concelho: p.concelho ?? null,
            preco: p.preco ?? null,
            quartos: p.quartos ?? null,
            area_util_m2: p.area_util_m2 ?? p.area_m2 ?? null,
            finalidade: p.finalidade ?? null,
          },
          score: s.score,
          reasons: s.reasons,
          categories: s.categories,
        }));
      return { lead, matches: scored };
    });

    return {
      total_capturas: parsed.total_capturas,
      total_properties: properties?.length ?? 0,
      results,
    };
  });