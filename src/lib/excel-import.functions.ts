import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as XLSX from "xlsx";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scoreMatch, type BuyerLike } from "./matching-engine";
import { buildDedupKey } from "./dedup";
import { upsertOne, recomputeForSearch, type UpsertRow } from "./active-searches.functions";
import { normalizeLocationsBatch } from "./location-normalize.server";
import { splitBuyerSearches, type SplitSearch } from "./search-splitter.server";

const DURATION_DAYS = 30;

const Input = z.object({
  fileBase64: z.string().min(10),
  filename: z.string().optional(),
});

// ---- helpers de normalização de células ----

function s(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}
function n(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}
function b(v: unknown): boolean {
  if (v == null) return false;
  const t = String(v).trim().toLowerCase();
  return ["sim", "s", "true", "1", "x", "y", "yes"].includes(t);
}

function parseFinalidade(v: unknown): "venda" | "arrendamento" | "indefinido" {
  const t = (s(v) ?? "").toLowerCase();
  if (/(compra|venda|comprar)/.test(t)) return "venda";
  if (/(arrend|renda|aluguer|alug)/.test(t)) return "arrendamento";
  return "indefinido";
}

// Classifica um texto como procura de comprador, oferta/anúncio, ou ambíguo.
// Regra 1.2.1: exigimos sinal EXPLÍCITO de procura para importar directamente.
// Se apenas parece anúncio → descartar. Se ambíguo → sinalizar para revisão.
export type BuyerTextClass = "procura" | "anuncio" | "ambiguo";

function classifyBuyerText(text: string | null): BuyerTextClass {
  if (!text) return "ambiguo";
  const t = text.toLowerCase();
  const procuraSignals = [
    /procur[oa]\b/, /procura(m|)\s+(por\s+)?[a-z]/,
    /(tenho|temos)\s+(cliente|comprador|casal|fam[ií]lia)/,
    /cliente\s+(aprovad|pretende|interess|procura|com\s+cr[eé]dito)/,
    /pretende\s+(comprar|arrendar|adquirir)/, /necessit[ao]/, /arrendat[aá]rio/,
    /interessad[oa]s?\s+em\s+(comprar|arrendar)/,
    /aprovad[oa]\s+para\s+cr[eé]dito/, /or[cç]amento\s+at[eé]/,
    /compra\s+urgente/, /precisa[m]?\s+de\s+(casa|apartamento|moradia)/,
  ];
  const hasProcura = procuraSignals.some((re) => re.test(t));
  const ofertaSignals = [
    /vende[- ]se/, /\bvendo\b/, /para\s+venda/, /arrenda[- ]se/, /para\s+arrendament/,
    /oportunidade\s+[uú]nica/, /novo\s+no\s+mercado/, /km\s*0/,
    /pre[cç]o\s+reduzid/, /an[uú]ncio/, /vis(ite|ita\s+virtual)/,
    /agende\s+visita/, /marque\s+visita/, /studio\s+novo/,
    /vista\s+(mar|rio)/, /inclui\s+garagem/, /remodelad[oa]\s+t[0-6]/,
    /\d+\s*€\s*\/\s*m[²2]/, /apresenta[cç][aã]o\s+de\s+(im[oó]vel|apartamento|moradia)/,
  ];
  const hasOferta = ofertaSignals.some((re) => re.test(t));
  // Sinal estrutural: preço + área + tipologia + morada sem verbo de procura.
  const hasPrice = /\d[\d.\s]{2,}\s*(€|eur)/.test(t);
  const hasArea = /\d+\s*m[²2]/.test(t);
  const hasTipologia = /\bt[0-6]\b/.test(t);
  const structuralAd = hasPrice && hasArea && hasTipologia && !hasProcura;

  if (hasProcura && !hasOferta) return "procura";
  if (hasOferta || structuralAd) return "anuncio";
  return "ambiguo";
}

// Mantém compatibilidade — devolve true quando não é anúncio confirmado.
function looksLikeBuyerSearch(text: string | null): boolean {
  return classifyBuyerText(text) !== "anuncio";
}

function parseTipologia(v: unknown): string | null {
  const t = s(v);
  if (!t) return null;
  const m = /t\s*([0-6])/i.exec(t);
  return m ? `T${m[1]}` : t.toUpperCase();
}

function parseTipoImovel(v: unknown): string[] | null {
  const t = (s(v) ?? "").toLowerCase();
  if (!t) return null;
  const map: Array<[RegExp, string]> = [
    [/apart|t\d/i, "Apartamento"],
    [/mora|casa|vivenda/i, "Moradia"],
    [/terreno|lote/i, "Terreno"],
    [/loja/i, "Loja"],
    [/escrit/i, "Escritório"],
    [/armaz/i, "Armazém"],
    [/pr[eé]dio/i, "Prédio"],
    [/comerc/i, "Espaço comercial"],
  ];
  const out = new Set<string>();
  for (const [re, label] of map) if (re.test(t)) out.add(label);
  return out.size ? Array.from(out) : null;
}

function parseCaracteristicas(v: unknown): string[] | null {
  const t = s(v);
  if (!t) return null;
  const parts = t.split(/[,;/|]+/).map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

function combineDate(dateVal: unknown, timeVal: unknown): string | null {
  const d = s(dateVal);
  if (!d) return null;
  const t = s(timeVal) ?? "00:00";
  const iso = new Date(`${d}T${t.length === 5 ? t : t + ":00"}`);
  return isNaN(iso.getTime()) ? d : iso.toISOString();
}

function pickBudget(v: unknown): { min: number | null; max: number | null } {
  const t = s(v);
  if (!t) return { min: null, max: null };
  const nums = Array.from(t.matchAll(/[\d.,]+/g))
    .map((m) => n(m[0]))
    .filter((x): x is number => x != null);
  if (nums.length === 0) return { min: null, max: null };
  if (nums.length === 1) return { min: null, max: nums[0] };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

// ---- server fn principal ----

export type ExcelImportResult = {
  analisadas: number;
  novas: number;
  atualizadas: number;
  mantidas_separadas: number;
  sinalizadas_revisao: number;
  removidas: number;
  matches: number;
  batch_id: string;
};

export const importSearchesFromExcel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<ExcelImportResult> => {
    const { supabase, userId } = context;

    // 1) Ler o Excel
    const b64 = data.fileBase64.includes(",") ? data.fileBase64.split(",")[1] : data.fileBase64;
    const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    const batch_id = `xlsx_${Date.now()}`;
    const expires = new Date(Date.now() + DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Índice case-insensitive de colunas
    const col = (row: Record<string, unknown>, ...names: string[]): unknown => {
      for (const nm of names) {
        for (const k of Object.keys(row)) {
          if (k.toLowerCase() === nm.toLowerCase()) return row[k];
        }
      }
      return null;
    };

    let novas = 0;
    let atualizadas = 0;
    let mantidas_separadas = 0;
    let sinalizadas_revisao = 0;
    const upsertedIds: string[] = [];

    // --- Release 1.2 P2#9: normalização IA das localidades em lote ---
    const rawZones = new Set<string>();
    for (const raw of rows) {
      const z = s(col(raw, "localizacao", "localização", "zona"));
      if (z) rawZones.add(z);
      const f = s(col(raw, "Freguesia"));
      if (f) rawZones.add(f);
      const m = s(col(raw, "Municipio", "Município", "Concelho"));
      if (m) rawZones.add(m);
    }
    const zoneMap = await normalizeLocationsBatch(rawZones);

    for (const raw of rows) {
      const nome = s(col(raw, "Nome"));
      const telefone = s(col(raw, "WhatsApp", "Telefone", "Telemovel", "Telemóvel"));
      const email = s(col(raw, "Email", "E-mail"));
      const finalidade = parseFinalidade(col(raw, "tipo_operacao", "operacao", "operação"));
      const tipoImovel = parseTipoImovel(col(raw, "tipo_imovel", "tipo"));
      const tipologia = parseTipologia(col(raw, "tipologia"));
      const budget = pickBudget(col(raw, "budget", "orcamento", "orçamento"));
      const zonaRaw = s(col(raw, "localizacao", "localização", "zona"));
      const freguesiaRaw = s(col(raw, "Freguesia"));
      const municipioRaw = s(col(raw, "Municipio", "Município", "Concelho"));
      const zona = zonaRaw ? zoneMap[zonaRaw] ?? zonaRaw : null;
      const freguesia = freguesiaRaw ? zoneMap[freguesiaRaw] ?? freguesiaRaw : null;
      const municipio = municipioRaw ? zoneMap[municipioRaw] ?? municipioRaw : null;
      const distrito = s(col(raw, "distrito", "Distrito"));
      const area = n(col(raw, "area", "área"));
      const area_terreno = n(col(raw, "area_terreno", "área_terreno"));
      const wc = n(col(raw, "wc", "WC"));
      const elevador = b(col(raw, "elevador_obrigatorio", "elevador"));
      const garagem = b(col(raw, "garagem_obrigatoria", "garagem"));
      const caract = parseCaracteristicas(col(raw, "caracteristicas_obrigatorias", "características"));
      const descricao = s(col(raw, "descricao", "descrição"));
      const mensagem = s(col(raw, "mensagem_original", "mensagem"));
      const dataPub = combineDate(col(raw, "data"), col(raw, "hora"));
      // Release 1.2 — metadados de contexto
      const dataOrigem = s(col(raw, "data"));
      const horaOrigem = s(col(raw, "hora"));
      const consultorNome = s(col(raw, "Consultor", "consultor", "Agente", "agente"));
      const consultorTelefone = s(col(raw, "Consultor_Telefone", "Telefone_Consultor", "consultor_telefone"));
      const comunidade = s(col(raw, "Comunidade", "comunidade"));
      const grupoWhatsapp = s(col(raw, "Grupo", "grupo", "grupo_whatsapp"));

      // Regra mínima: precisa de telefone OU (nome + algum critério) para ser útil
      if (!telefone && !nome) continue;

      // Release 1.2.1 — classificar rigorosamente. Anúncios são descartados;
      // casos ambíguos são importados mas sinalizados para revisão manual.
      const textClass = classifyBuyerText(mensagem ?? descricao);
      if (textClass === "anuncio") continue;
      const flagAsReview = textClass === "ambiguo";

      const caracExtras: string[] = [...(caract ?? [])];
      if (elevador) caracExtras.push("elevador");
      if (garagem) caracExtras.push("garagem");

      const baseCriteria = {
        nome,
        finalidade,
        tipo_imovel: tipoImovel,
        tipologia,
        zona,
        freguesia,
        municipio,
        distrito,
        budget_min: budget.min,
        budget_max: budget.max,
        area_min: area,
        area_terreno_min: area_terreno,
        wc_min: wc,
        quartos_min: tipologia ? Number(tipologia.replace(/\D/g, "")) || null : null,
        caracteristicas: caracExtras.length ? caracExtras : null,
      };

      // Release 2.1 — separar automaticamente múltiplas procuras num único texto.
      const rawText = mensagem ?? descricao ?? "";
      const splits = await splitBuyerSearches(rawText, {
        finalidade,
        tipo_imovel: tipoImovel,
        tipologia,
        zona,
        budget_min: budget.min,
        budget_max: budget.max,
        area_min: area,
        quartos_min: baseCriteria.quartos_min,
        caracteristicas: baseCriteria.caracteristicas,
        resumo: descricao,
      });

      for (let idx = 0; idx < splits.length; idx++) {
        const sp: SplitSearch = splits[idx];
        // Cada procura é INDEPENDENTE: só herda contactos e metadados. Nunca
        // partilhamos zona/tipologia/orçamento entre procuras separadas.
        const spZona = sp.zona ?? null;
        const spMunicipio = sp.municipio ?? null;
        const spFreguesia = sp.freguesia ?? null;
        const spTipologia = sp.tipologia ?? null;
        const criteria = {
          nome,
          finalidade: sp.finalidade ?? "indefinido",
          tipo_imovel: sp.tipo_imovel ?? null,
          tipologia: spTipologia,
          zona: spZona,
          freguesia: spFreguesia,
          municipio: spMunicipio,
          distrito: distrito,
          budget_min: sp.budget_min ?? null,
          budget_max: sp.budget_max ?? null,
          area_min: sp.area_min ?? null,
          area_terreno_min: area_terreno,
          wc_min: wc,
          quartos_min:
            sp.quartos_min ??
            (spTipologia ? Number(spTipologia.replace(/\D/g, "")) || null : null),
          caracteristicas: sp.caracteristicas ?? null,
        };

        const dedup_key = buildDedupKey({
          telefone,
          nome,
          finalidade: (sp.finalidade ?? "indefinido") as any,
          tipologia: spTipologia,
          tipo_imovel: sp.tipo_imovel ?? null,
          zona: spZona ?? spMunicipio ?? spFreguesia,
        });

        const row: UpsertRow = {
          dedup_key,
          criteria,
          resumo: sp.resumo ?? descricao,
          texto_original: rawText,
          contact_nome: nome,
          contact_telefone: telefone,
          contact_email: email,
          contact_grupo: grupoWhatsapp,
          data_publicacao: dataPub,
          expires_at: expires,
          origem: "excel",
          import_batch_id: batch_id,
          consultor_nome: consultorNome,
          consultor_telefone: consultorTelefone,
          data_origem: dataOrigem,
          hora_origem: horaOrigem,
          grupo_whatsapp: grupoWhatsapp,
          comunidade,
        };

        try {
          const res = await upsertOne(supabase, userId, row);
          upsertedIds.push(res.id);
          switch (res.action) {
            case "created":
              novas++;
              break;
            case "updated":
              atualizadas++;
              break;
            case "kept_separate":
              mantidas_separadas++;
              break;
            case "flagged":
              sinalizadas_revisao++;
              break;
          }
        } catch (e) {
          console.error("Excel row upsert failed", e);
        }
      }
    }

    // 2) Regra Release 1.1: procuras ausentes do ficheiro NÃO são desativadas
    //    pela sync. Deixam apenas de estar ativas quando expirarem pelo TTL.
    const removidas = 0;

    // 3) Match imediato — para as procuras deste batch
    const { data: properties } = await supabase
      .from("properties")
      .select(
        "id, referencia, tipo_imovel, tipologia, distrito, concelho, freguesia, zona, preco, area_util_m2, area_m2, quartos, garagem, elevador, jardim, piscina, finalidade",
      )
      .eq("user_id", userId)
      .eq("ativo", true);

    const { data: searches } = await supabase
      .from("active_searches")
      .select("id, criteria")
      .eq("user_id", userId)
      .eq("import_batch_id", batch_id);

    let matches = 0;
    for (const s of searches ?? []) {
      const c = s.criteria as Record<string, any>;
      const buyer: BuyerLike = {
        finalidade: c.finalidade === "indefinido" ? undefined : c.finalidade,
        tipo_imovel: c.tipo_imovel ?? null,
        tipologia: c.tipologia ?? null,
        zona: c.zona ?? c.municipio ?? c.freguesia ?? null,
        budget_min: c.budget_min ?? null,
        budget_max: c.budget_max ?? null,
        area_min: c.area_min ?? null,
        quartos_min: c.quartos_min ?? null,
        garagem_obrigatoria: (c.caracteristicas ?? []).some((x: string) => /garagem/i.test(x)),
        elevador_obrigatorio: (c.caracteristicas ?? []).some((x: string) => /elevador/i.test(x)),
      };
      let has = false;
      for (const p of properties ?? []) {
        const r = scoreMatch(buyer, p);
        if (r.compatible && r.score >= 60) {
          matches++;
          has = true;
        }
      }
      if (has) {
        await supabase
          .from("active_searches")
          .update({ last_match_at: new Date().toISOString() })
          .eq("id", s.id);
      }
      // Release 1.1: materializar oportunidades para cada procura importada.
      try {
        await recomputeForSearch(supabase, userId, s.id);
      } catch (e) {
        console.error("excel: recomputeForSearch failed", e);
      }
    }

    return {
      analisadas: rows.length,
      novas,
      atualizadas,
      mantidas_separadas,
      sinalizadas_revisao,
      removidas,
      matches,
      batch_id,
    };
  });
