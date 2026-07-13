import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as XLSX from "xlsx";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scoreMatch, type BuyerLike } from "./matching-engine";
import { buildDedupKey } from "./dedup";
import { upsertOne, recomputeForSearch, type UpsertRow } from "./active-searches.functions";
import { splitBuyerSearches, mayContainMultipleSearches, type SplitSearch } from "./search-splitter.server";

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
  const d = normalizeExcelDate(dateVal);
  if (!d) return null;
  const t = normalizeExcelTime(timeVal) ?? "00:00";
  const iso = new Date(`${d}T${t.length === 5 ? t : t + ":00"}:00Z`);
  return isNaN(iso.getTime()) ? `${d}T00:00:00Z` : iso.toISOString();
}

// Converte Date real, número de série do Excel ou string em "YYYY-MM-DD".
// Devolve null se não for possível obter uma data válida — nunca devolve o
// número de série (ex.: "46215") nem strings malformadas (ex.: "2026-07-012").
export function normalizeExcelDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (!parsed) return null;
    const { y, m, d } = parsed;
    if (!y || !m || !d) return null;
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const raw = String(v).trim();
  if (!raw) return null;
  // Serial numérico como string
  if (/^\d+(\.\d+)?$/.test(raw)) return normalizeExcelDate(Number(raw));
  // ISO YYYY-MM-DD
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // DD/MM/YYYY ou DD-MM-YYYY
  const dmy = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dmy) {
    const d = Number(dmy[1]);
    let m = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function normalizeExcelTime(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const frac = v - Math.floor(v);
    const totalSec = Math.round(frac * 86400);
    const hh = String(Math.floor(totalSec / 3600) % 24).padStart(2, "0");
    const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const t = String(v).trim();
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
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
  duplicados_exatos_fundidos: number;
  mantidas_separadas: number;
  sinalizadas_revisao: number;
  removidas: number;
  matches: number;
  batch_id: string;
  ignoradas_sem_contacto: number;
  descartadas_anuncio: number;
  erros: number;
  total_check: boolean;
  linhas: Array<{
    linha: number;
    comprador: string | null;
    consultor: string | null;
    resultado:
      | "Nova"
      | "Atualizada"
      | "Duplicado exato"
      | "Revisão"
      | "Separada"
      | "Ignorada"
      | "Descartada"
      | "Erro";
    motivo: string;
  }>;
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
    let duplicados_exatos_fundidos = 0;
    let mantidas_separadas = 0;
    let sinalizadas_revisao = 0;
    let ignoradas_sem_contacto = 0;
    let descartadas_anuncio = 0;
    let erros = 0;
    const upsertedIds: string[] = [];
    const linhas: ExcelImportResult["linhas"] = [];

    // Prioridade quando uma linha origina múltiplos splits: o resultado mais
    // "forte" domina, para que cada linha analisada termine numa e só uma
    // classificação final.
    const priority: Record<string, number> = {
      flagged: 5,
      updated: 4,
      duplicado_exato: 3,
      kept_separate: 2,
      created: 1,
    };

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const raw = rows[rowIndex];
      // Linha 1 do Excel é o cabeçalho; a primeira linha de dados é a 2.
      const linhaNumero = rowIndex + 2;
      const nome = s(col(raw, "Nome"));
      const telefone = s(col(raw, "WhatsApp", "Telefone", "Telemovel", "Telemóvel"));
      const email = s(col(raw, "Email", "E-mail"));
      const finalidade = parseFinalidade(col(raw, "tipo_operacao", "operacao", "operação"));
      const tipoImovel = parseTipoImovel(col(raw, "tipo_imovel", "tipo"));
      const tipologia = parseTipologia(col(raw, "tipologia"));
      const budget = pickBudget(col(raw, "budget", "orcamento", "orçamento"));
      // Preservar sempre os valores originais das localizações. A
      // normalização por IA foi removida (Correções Pós-1.3): a IA não pode
      // alterar automaticamente os dados importados. Sugestões continuam
      // disponíveis via aba Revisão.
      const zona = s(col(raw, "localizacao", "localização", "zona"));
      const freguesia = s(col(raw, "Freguesia"));
      const municipio = s(col(raw, "Municipio", "Município", "Concelho"));
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

      const consultorLabel = consultorNome ?? consultorTelefone ?? null;

      // Regra mínima: precisa de telefone OU nome para ser útil.
      if (!telefone && !nome) {
        ignoradas_sem_contacto++;
        linhas.push({
          linha: linhaNumero,
          comprador: null,
          consultor: consultorLabel,
          resultado: "Ignorada",
          motivo: "Sem contacto (telefone e nome em falta)",
        });
        continue;
      }

      // Release 1.2.1 — classificar rigorosamente. Anúncios são descartados;
      // casos ambíguos são importados mas sinalizados para revisão manual.
      const textClass = classifyBuyerText(mensagem ?? descricao);
      if (textClass === "anuncio") {
        descartadas_anuncio++;
        linhas.push({
          linha: linhaNumero,
          comprador: nome,
          consultor: consultorLabel,
          resultado: "Descartada",
          motivo: "Texto parece anúncio, não procura de comprador",
        });
        continue;
      }
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
      // Release 1.2.1 — só chamamos IA quando o pré-detector determinístico
      // aponta para múltiplas procuras. Poupa créditos e latência.
      const fallbackSearch: SplitSearch = {
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
      };
      const splits = mayContainMultipleSearches(rawText)
        ? await splitBuyerSearches(rawText, fallbackSearch)
        : [fallbackSearch];

      // Recolhe o resultado de cada split para consolidar numa única
      // classificação por linha depois do loop interno.
      const splitOutcomes: Array<{ kind: string; reason: string }> = [];

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
          if (flagAsReview) {
            // Sinaliza para revisão manual sem impedir o fluxo.
            try {
              await supabase
                .from("active_searches")
                .update({
                  flagged_for_review: true,
                  decision_reason: "Não parece procura de comprador — rever manualmente",
                })
                .eq("id", res.id);
            } catch (e) {
              console.error("flag ambiguous failed", e);
            }
            splitOutcomes.push({
              kind: "flagged",
              reason: "Texto ambíguo — enviada para Revisão",
            });
            sinalizadas_revisao++;
            continue;
          }
          switch (res.action) {
            case "created":
              novas++;
              splitOutcomes.push({ kind: "created", reason: res.reason || "Nova procura" });
              break;
            case "updated":
              if ((res.reason ?? "").includes("auto-merge")) {
                duplicados_exatos_fundidos++;
                splitOutcomes.push({
                  kind: "duplicado_exato",
                  reason: "Duplicado exato — fundido automaticamente",
                });
              } else {
                atualizadas++;
                splitOutcomes.push({
                  kind: "updated",
                  reason: res.reason || "Registo atualizado",
                });
              }
              break;
            case "kept_separate":
              mantidas_separadas++;
              splitOutcomes.push({
                kind: "kept_separate",
                reason: res.reason || "Mantida separada",
              });
              break;
            case "flagged":
              sinalizadas_revisao++;
              splitOutcomes.push({
                kind: "flagged",
                reason: res.reason || "Enviada para Revisão",
              });
              break;
          }
        } catch (e) {
          console.error("Excel row upsert failed", e);
          splitOutcomes.push({
            kind: "erro",
            reason: e instanceof Error ? e.message : "Erro desconhecido",
          });
        }
      }

      // Consolidar num único resultado por linha.
      if (splitOutcomes.length === 0) {
        erros++;
        linhas.push({
          linha: linhaNumero,
          comprador: nome,
          consultor: consultorLabel,
          resultado: "Erro",
          motivo: "Nenhum split processado",
        });
        continue;
      }
      const anyError = splitOutcomes.find((o) => o.kind === "erro");
      if (anyError) {
        // Se qualquer split falhou, a linha inteira conta como Erro.
        // Reverte incrementos parciais dos outros splits desta linha para
        // manter a invariante "1 linha = 1 classificação".
        for (const o of splitOutcomes) {
          if (o.kind === "created") novas--;
          else if (o.kind === "updated") atualizadas--;
          else if (o.kind === "duplicado_exato") duplicados_exatos_fundidos--;
          else if (o.kind === "kept_separate") mantidas_separadas--;
          else if (o.kind === "flagged") sinalizadas_revisao--;
        }
        erros++;
        linhas.push({
          linha: linhaNumero,
          comprador: nome,
          consultor: consultorLabel,
          resultado: "Erro",
          motivo: anyError.reason,
        });
        continue;
      }
      // Escolhe o outcome dominante pela ordem de prioridade.
      splitOutcomes.sort((a, b) => (priority[b.kind] ?? 0) - (priority[a.kind] ?? 0));
      const top = splitOutcomes[0];
      const label: ExcelImportResult["linhas"][number]["resultado"] =
        top.kind === "flagged"
          ? "Revisão"
          : top.kind === "updated"
            ? "Atualizada"
            : top.kind === "duplicado_exato"
              ? "Duplicado exato"
              : top.kind === "kept_separate"
                ? "Separada"
                : "Nova";
      const motivo =
        splitOutcomes.length > 1
          ? `${top.reason} (linha originou ${splitOutcomes.length} procuras)`
          : top.reason;
      linhas.push({
        linha: linhaNumero,
        comprador: nome,
        consultor: consultorLabel,
        resultado: label,
        motivo,
      });
    }

    // 2) Regra Release 1.1: procuras ausentes do ficheiro NÃO são desativadas
    //    pela sync. Deixam apenas de estar ativas quando expirarem pelo TTL.
    const removidas = 0;

    // 3) Match imediato — para as procuras deste batch
    const { data: properties } = await supabase
      .from("properties")
      .select(
        "id, referencia, tipo_imovel, tipologia, distrito, concelho, freguesia, zona, preco, area_util_m2, area_m2, area_terreno_m2, quartos, garagem, elevador, jardim, piscina, finalidade",
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

    const somaFinal =
      novas +
      atualizadas +
      duplicados_exatos_fundidos +
      mantidas_separadas +
      sinalizadas_revisao +
      ignoradas_sem_contacto +
      descartadas_anuncio +
      erros;
    const total_check = somaFinal === rows.length;
    if (!total_check) {
      console.warn(
        `[excel-import] contabilização inconsistente: analisadas=${rows.length} soma=${somaFinal}`,
      );
    }

    return {
      analisadas: rows.length,
      novas,
      atualizadas,
      duplicados_exatos_fundidos,
      mantidas_separadas,
      sinalizadas_revisao,
      removidas,
      matches,
      batch_id,
      ignoradas_sem_contacto,
      descartadas_anuncio,
      erros,
      total_check,
      linhas,
    };
  });
