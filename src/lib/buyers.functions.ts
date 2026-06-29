import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callLovableAI } from "./ai-gateway.server";

const ListingSchema = z.object({
  titulo: z.string().nullable().optional(),
  finalidade: z.enum(["venda", "arrendamento"]).default("venda"),
  preco: z.number().nullable().optional(),
  tipologia: z.string().nullable().optional(),
  zona: z.string().nullable().optional(),
  concelho: z.string().nullable().optional(),
  tipo_imovel: z.string().nullable().optional(),
  area_m2: z.number().nullable().optional(),
  quartos: z.number().nullable().optional(),
  casas_banho: z.number().nullable().optional(),
  andar: z.number().nullable().optional(),
  tem_garagem: z.boolean().nullable().optional(),
  tem_elevador: z.boolean().nullable().optional(),
  descricao: z.string().nullable().optional(),
  imagem_url: z.string().nullable().optional(),
});

async function firecrawlScrape(url: string): Promise<{ markdown?: string; metadata?: Record<string, unknown> }> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY não configurado");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
  });
  if (res.status === 402) throw new Error("CREDITOS_FIRECRAWL_ESGOTADOS");
  if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: { markdown?: string; metadata?: Record<string, unknown> } };
  return json.data ?? {};
}

function detectPortal(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h;
  } catch {
    return "desconhecido";
  }
}

export const importListingFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ url: z.string().url() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Check existing
    const { data: existing } = await supabase
      .from("portal_listings")
      .select("*")
      .eq("user_id", userId)
      .eq("url", data.url)
      .maybeSingle();

    const scrape = await firecrawlScrape(data.url);
    const markdown = scrape.markdown ?? "";
    if (!markdown) throw new Error("Não foi possível extrair conteúdo da página.");

    const sys = `És um assistente de mediação imobiliária. Recebes o conteúdo (markdown) de uma página de anúncio de um portal imobiliário português (Idealista, Imovirtual, Casa Sapo, etc.).
Extrai os dados estruturados do imóvel. Responde APENAS com JSON válido com este schema:
{"titulo":string|null,"finalidade":"venda"|"arrendamento","preco":number|null,"tipologia":string|null,"zona":string|null,"concelho":string|null,"tipo_imovel":string|null,"area_m2":number|null,"quartos":number|null,"casas_banho":number|null,"andar":number|null,"tem_garagem":boolean|null,"tem_elevador":boolean|null,"descricao":string|null,"imagem_url":string|null}
- preco em euros (número, sem símbolos).
- tipo_imovel: "apartamento","moradia","terreno","escritorio","loja" etc.
- tipologia: "T0","T1","T2","T3","T4","T5+".
- Se algum campo não estiver claro, devolve null.`;

    const raw = await callLovableAI({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: markdown.slice(0, 15000) },
      ],
    });

    let parsed: z.infer<typeof ListingSchema>;
    try {
      parsed = ListingSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error("A IA não conseguiu interpretar o anúncio.");
    }

    const portal = detectPortal(data.url);
    const novoPreco = parsed.preco ?? null;
    const precoAnterior = existing && existing.preco != null && novoPreco != null && Number(existing.preco) !== novoPreco
      ? Number(existing.preco)
      : existing?.preco_anterior ?? null;

    const payload = {
      user_id: userId,
      url: data.url,
      portal,
      titulo: parsed.titulo ?? null,
      finalidade: parsed.finalidade,
      preco: novoPreco,
      preco_anterior: precoAnterior,
      tipologia: parsed.tipologia ?? null,
      zona: parsed.zona ?? null,
      concelho: parsed.concelho ?? null,
      tipo_imovel: parsed.tipo_imovel ?? null,
      area_m2: parsed.area_m2 ?? null,
      quartos: parsed.quartos ?? null,
      casas_banho: parsed.casas_banho ?? null,
      andar: parsed.andar ?? null,
      tem_garagem: parsed.tem_garagem ?? null,
      tem_elevador: parsed.tem_elevador ?? null,
      descricao: parsed.descricao ?? null,
      imagem_url: parsed.imagem_url ?? null,
      ultima_verificacao: new Date().toISOString(),
    };

    const { data: saved, error } = await supabase
      .from("portal_listings")
      .upsert(payload, { onConflict: "user_id,url" })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const baixaPreco = precoAnterior != null && novoPreco != null && novoPreco < precoAnterior;
    return { listing: saved, novo: !existing, baixaPreco };
  });

export const matchBuyersWithListings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: buyers }, { data: listings }] = await Promise.all([
      supabase.from("buyer_clients").select("*").eq("user_id", userId).eq("ativo", true),
      supabase.from("portal_listings").select("*").eq("user_id", userId),
    ]);

    const results = (buyers ?? []).map((b) => {
      const ranked = (listings ?? [])
        .map((l) => {
          let score = 0;
          const reasons: string[] = [];
          const blockers: string[] = [];

          if (b.finalidade && l.finalidade && b.finalidade === l.finalidade) {
            score += 30;
            reasons.push(`Finalidade ${l.finalidade}`);
          } else if (b.finalidade && l.finalidade && b.finalidade !== l.finalidade) {
            blockers.push("finalidade diferente");
          }

          if (b.tipologia && l.tipologia && l.tipologia.toLowerCase().includes(b.tipologia.toLowerCase())) {
            score += 20;
            reasons.push(`Tipologia ${l.tipologia}`);
          }
          if (b.zona && l.zona) {
            const bz = b.zona.toLowerCase();
            if (l.zona.toLowerCase().includes(bz) || (l.concelho ?? "").toLowerCase().includes(bz)) {
              score += 20;
              reasons.push(`Zona ${l.zona}`);
            }
          }
          if (b.tipo_imovel && l.tipo_imovel && l.tipo_imovel.toLowerCase().includes(b.tipo_imovel.toLowerCase())) {
            score += 10;
            reasons.push(`Tipo ${l.tipo_imovel}`);
          }
          if (b.budget_max && l.preco != null) {
            if (Number(l.preco) <= Number(b.budget_max)) {
              score += 15;
              reasons.push("Dentro do orçamento");
            } else if (Number(l.preco) > Number(b.budget_max) * 1.1) {
              blockers.push("acima do orçamento");
            }
          }
          if (b.budget_min && l.preco != null && Number(l.preco) < Number(b.budget_min) * 0.7) {
            blockers.push("muito abaixo do orçamento");
          }
          if (b.area_min && l.area_m2 != null && Number(l.area_m2) < Number(b.area_min)) {
            blockers.push(`área < ${b.area_min}m²`);
          }
          if (b.quartos_min && l.quartos != null && l.quartos < b.quartos_min) {
            blockers.push(`quartos < ${b.quartos_min}`);
          }
          if (b.andar_min && l.andar != null && l.andar < b.andar_min) {
            blockers.push(`andar < ${b.andar_min}`);
          }
          if (b.garagem_obrigatoria && l.tem_garagem === false) {
            blockers.push("sem garagem");
          } else if (b.garagem_obrigatoria && l.tem_garagem === true) {
            score += 5;
            reasons.push("Com garagem");
          }
          if (b.elevador_obrigatorio && l.tem_elevador === false) {
            blockers.push("sem elevador");
          } else if (b.elevador_obrigatorio && l.tem_elevador === true) {
            score += 5;
            reasons.push("Com elevador");
          }

          const baixaPreco = l.preco_anterior != null && l.preco != null && Number(l.preco) < Number(l.preco_anterior);
          if (baixaPreco) {
            score += 10;
            reasons.push("Baixa de preço");
          }

          return { listing: l, score, reasons, blockers, baixaPreco };
        })
        .filter((m) => m.blockers.length === 0 && m.score >= 30)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      return { buyer: b, matches: ranked };
    });

    return { results, totalBuyers: buyers?.length ?? 0, totalListings: listings?.length ?? 0 };
  });