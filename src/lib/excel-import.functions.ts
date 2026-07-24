import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as XLSX from "xlsx";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildDedupKey } from "./dedup";
import { upsertOne, recomputeForBatch, type UpsertRow } from "./active-searches.functions";
import { splitBuyerSearches, mayContainMultipleSearches, type SplitSearch } from "./search-splitter.server";
import {
  classifyBuyerText,
  detectRoleSignal,
  evaluateSearchAcceptance,
  type AcceptanceDecision,
  type BuyerTextClass,
  type RoleSignal,
} from "./search-acceptance";
import { normalizeSearchBedrooms } from "./bedrooms-normalize";
import { LocationRepository } from "./geo/location-repository";
import { parseLocations } from "./geo";

// Re-exportar para manter compatibilidade com consumidores existentes; a
// implementação vive agora em src/lib/search-acceptance.ts (fonte única).
export {
  classifyBuyerText,
  detectRoleSignal,
  evaluateSearchAcceptance,
};
export type { AcceptanceDecision, BuyerTextClass, RoleSignal };

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

// (classificação vive em ./search-acceptance — re-exports acima)

function parseTipologia(v: unknown): string | null {
  // Delega no normalizador único; mantém assinatura antiga para o resto do ficheiro.
  return normalizeSearchBedrooms({ tipologia: v }, "excel-import").tipologia;
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

// ---------------------------------------------------------------------------
// Release 1.2.4 — Deteção automática da linha de cabeçalhos
// ---------------------------------------------------------------------------
//
// Alguns exports (ex.: RECLUB) colocam a linha de cabeçalhos na 3ª/4ª linha
// do ficheiro, com títulos/datas nas linhas acima. Percorremos até 20 linhas
// e escolhemos a que contém o maior número de cabeçalhos reconhecidos. Se
// nenhuma linha tiver pelo menos 2 cabeçalhos reconhecidos, assumimos linha 0
// (comportamento anterior).

const HEADER_KEYWORDS = [
  "nome",
  "whatsapp",
  "telefone",
  "telemovel",
  "telemóvel",
  "email",
  "e-mail",
  "tipo_operacao",
  "operacao",
  "operação",
  "tipo_imovel",
  "tipo",
  "tipologia",
  "budget",
  "orcamento",
  "orçamento",
  "localizacao",
  "localização",
  "zona",
  "freguesia",
  "municipio",
  "município",
  "concelho",
  "distrito",
  "area",
  "área",
  "wc",
  "elevador",
  "garagem",
  "descricao",
  "descrição",
  "mensagem",
  "mensagem_original",
  "data",
  "hora",
  "consultor",
  "agente",
  "comunidade",
  "grupo",
];

const normHeader = (v: unknown): string =>
  (v == null ? "" : String(v))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

function detectHeaderRow(matrix: unknown[][]): { headerIndex: number; headers: string[] } {
  const limit = Math.min(matrix.length, 20);
  let bestIndex = 0;
  let bestScore = 0;
  for (let i = 0; i < limit; i++) {
    const row = matrix[i] ?? [];
    let score = 0;
    for (const cell of row) {
      const nc = normHeader(cell);
      if (!nc) continue;
      if (HEADER_KEYWORDS.includes(nc)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  // Exige pelo menos 2 cabeçalhos reconhecidos para aceitar deteção; caso
  // contrário assume que a linha 0 é o cabeçalho (comportamento anterior).
  if (bestScore < 2) bestIndex = 0;
  const headerRow = matrix[bestIndex] ?? [];
  const headers = headerRow.map((c) => (c == null ? "" : String(c)));
  return { headerIndex: bestIndex, headers };
}

/** Uma linha já normalizada, pronta para atravessar o wire nos chunks. */
export type PreparedExcelRow = {
  linha: number;
  data: Record<string, string | number | boolean | null>;
};

function parseWorkbookRows(fileBase64: string): {
  rows: PreparedExcelRow[];
  headerIndex: number;
  headers: string[];
} {
  const b64 = fileBase64.includes(",") ? fileBase64.split(",")[1] : fileBase64;
  const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });
  const { headerIndex, headers } = detectHeaderRow(matrix);
  const out: PreparedExcelRow[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const arr = matrix[i] ?? [];
    const obj: Record<string, string | number | boolean | null> = {};
    let hasValue = false;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const cell = arr[c];
      let val: string | number | boolean | null;
      if (cell == null) val = null;
      else if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") val = cell;
      else val = String(cell);
      obj[key] = val;
      if (val != null && String(val).trim() !== "") hasValue = true;
    }
    if (!hasValue) continue;
    out.push({ linha: i + 1, data: obj });
  }
  return { rows: out, headerIndex, headers };
}

// Contadores incrementais devolvidos por cada chunk.
export type ChunkCounters = {
  novas: number;
  atualizadas: number;
  duplicados_exatos_fundidos: number;
  mantidas_separadas: number;
  sinalizadas_revisao: number;
  ignoradas_sem_contacto: number;
  descartadas_anuncio: number;
  erros: number;
};

const priority: Record<string, number> = {
  flagged: 5,
  updated: 4,
  duplicado_exato: 3,
  kept_separate: 2,
  created: 1,
};

const col = (row: Record<string, unknown>, ...names: string[]): unknown => {
  for (const nm of names) {
    for (const k of Object.keys(row)) {
      if (k.toLowerCase() === nm.toLowerCase()) return row[k];
    }
  }
  return null;
};

type OneRowOutcome = {
  linha: ExcelImportResult["linhas"][number];
  deltas: ChunkCounters;
  upsertedIds: string[];
};

async function processOneRow(
  supabase: any,
  userId: string,
  raw: Record<string, unknown>,
  linhaNumero: number,
  batch_id: string,
  expires: string,
  geoSnap: Awaited<ReturnType<typeof LocationRepository.getSnapshot>>,
): Promise<OneRowOutcome> {
  const deltas: ChunkCounters = {
    novas: 0,
    atualizadas: 0,
    duplicados_exatos_fundidos: 0,
    mantidas_separadas: 0,
    sinalizadas_revisao: 0,
    ignoradas_sem_contacto: 0,
    descartadas_anuncio: 0,
    erros: 0,
  };
  const upsertedIds: string[] = [];
      const nome = s(col(raw, "Nome"));
      const telefone = s(col(raw, "WhatsApp", "Telefone", "Telemovel", "Telemóvel"));
      const email = s(col(raw, "Email", "E-mail"));
      const finalidade = parseFinalidade(col(raw, "tipo_operacao", "operacao", "operação"));
      const tipoImovel = parseTipoImovel(col(raw, "tipo_imovel", "tipo"));
      const tipologia = parseTipologia(col(raw, "tipologia"));
      const budget = pickBudget(col(raw, "budget", "orcamento", "orçamento"));
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
      const dataOrigem = normalizeExcelDate(col(raw, "data"));
      const horaOrigem = normalizeExcelTime(col(raw, "hora"));
      const consultorNome = s(col(raw, "Consultor", "consultor", "Agente", "agente"));
      const consultorTelefone = s(col(raw, "Consultor_Telefone", "Telefone_Consultor", "consultor_telefone"));
      const comunidade = s(col(raw, "Comunidade", "comunidade"));
      const grupoWhatsapp = s(col(raw, "Grupo", "grupo", "grupo_whatsapp"));

      const consultorLabel = consultorNome ?? consultorTelefone ?? null;

      if (!telefone && !nome) {
    deltas.ignoradas_sem_contacto++;
    return {
      deltas,
      upsertedIds,
      linha: {
          linha: linhaNumero,
          comprador: null,
          consultor: consultorLabel,
          resultado: "Ignorada",
          motivo: "Sem contacto (telefone e nome em falta)",
      },
    };
      }

      const structuredZone = zona ?? municipio ?? freguesia;
      const hasStructured =
        finalidade !== "indefinido" &&
        !!tipoImovel &&
        !!structuredZone &&
        (budget.max != null || budget.min != null);
      const decision = evaluateSearchAcceptance({
        text: mensagem ?? descricao,
        finalidade,
        hasStructured,
      });
      if (decision.kind === "anuncio") {
    deltas.descartadas_anuncio++;
    return {
      deltas,
      upsertedIds,
      linha: {
          linha: linhaNumero,
          comprador: nome,
          consultor: consultorLabel,
          resultado: "Descartada",
          motivo: decision.reason,
      },
    };
      }
      const flagAsReview = decision.kind === "revisao";
      const reviewReason = decision.reason;

      const caracExtras: string[] = [...(caract ?? [])];
      if (elevador) caracExtras.push("elevador");
      if (garagem) caracExtras.push("garagem");

      const baseBedrooms = normalizeSearchBedrooms({ tipologia }, "excel-import:baseCriteria");
      const baseCriteria = {
        nome,
        finalidade,
        tipo_imovel: tipoImovel,
        tipologia: baseBedrooms.tipologia,
        zona,
        freguesia,
        municipio,
        distrito,
        budget_min: budget.min,
        budget_max: budget.max,
        area_min: area,
        area_terreno_min: area_terreno,
        wc_min: wc,
        quartos_min: baseBedrooms.quartos_min,
        caracteristicas: caracExtras.length ? caracExtras : null,
      };

      const rawText = mensagem ?? descricao ?? "";
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

      const splitOutcomes: Array<{ kind: string; reason: string }> = [];

      for (let idx = 0; idx < splits.length; idx++) {
        const sp: SplitSearch = splits[idx];
        const spZona = sp.zona ?? null;
        const spMunicipio = sp.municipio ?? null;
        const spFreguesia = sp.freguesia ?? null;
        const spBedrooms = normalizeSearchBedrooms(
          { tipologia: sp.tipologia, quartos_min: sp.quartos_min },
          "excel-import:split",
        );
        const spTipologia = spBedrooms.tipologia;
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
          quartos_min: spBedrooms.quartos_min,
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

        const geoCandidates = [spFreguesia, spZona, spMunicipio, distrito]
          .map((v) => (v ?? "").trim())
          .filter((v) => v.length > 0);
        const resolvedLocationIds: string[] = [];
        let firstUnresolvedGeoText: string | null = null;
        for (const text of geoCandidates) {
          const r = parseLocations(text, geoSnap);
          if (r.resolved.length > 0) {
            for (const id of r.resolved) if (!resolvedLocationIds.includes(id)) resolvedLocationIds.push(id);
            break;
          }
          if (firstUnresolvedGeoText == null) firstUnresolvedGeoText = text;
        }
        const geoFlag =
          resolvedLocationIds.length === 0 && firstUnresolvedGeoText
            ? { flagged: true, reason: `Zona por interpretar: "${firstUnresolvedGeoText}"` }
            : null;

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
          location_ids: resolvedLocationIds,
        };

        try {
          const res = await upsertOne(supabase, userId, row);
          upsertedIds.push(res.id);
          if (geoFlag && !flagAsReview) {
            try {
              await supabase
                .from("active_searches")
                .update({ flagged_for_review: true, decision_reason: geoFlag.reason })
                .eq("id", res.id);
            } catch (e) {
              console.error("flag geo unresolved failed", e);
            }
            splitOutcomes.push({ kind: "flagged", reason: geoFlag.reason });
        deltas.sinalizadas_revisao++;
            continue;
          }
          if (flagAsReview) {
            try {
              await supabase
                .from("active_searches")
                .update({
                  flagged_for_review: true,
                  decision_reason: reviewReason,
                })
                .eq("id", res.id);
            } catch (e) {
              console.error("flag ambiguous failed", e);
            }
            splitOutcomes.push({
              kind: "flagged",
              reason: reviewReason,
            });
        deltas.sinalizadas_revisao++;
            continue;
          }
          switch (res.action) {
            case "created":
          deltas.novas++;
              splitOutcomes.push({ kind: "created", reason: res.reason || "Nova procura" });
              break;
            case "updated":
              if ((res.reason ?? "").includes("auto-merge")) {
            deltas.duplicados_exatos_fundidos++;
                splitOutcomes.push({
                  kind: "duplicado_exato",
                  reason: "Duplicado exato — fundido automaticamente",
                });
              } else {
            deltas.atualizadas++;
                splitOutcomes.push({
                  kind: "updated",
                  reason: res.reason || "Registo atualizado",
                });
              }
              break;
            case "kept_separate":
          deltas.mantidas_separadas++;
              splitOutcomes.push({
                kind: "kept_separate",
                reason: res.reason || "Mantida separada",
              });
              break;
            case "flagged":
          deltas.sinalizadas_revisao++;
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

      if (splitOutcomes.length === 0) {
    deltas.erros++;
    return {
      deltas,
      upsertedIds,
      linha: {
          linha: linhaNumero,
          comprador: nome,
          consultor: consultorLabel,
          resultado: "Erro",
          motivo: "Nenhum split processado",
      },
    };
      }
      const anyError = splitOutcomes.find((o) => o.kind === "erro");
      if (anyError) {
        for (const o of splitOutcomes) {
      if (o.kind === "created") deltas.novas--;
      else if (o.kind === "updated") deltas.atualizadas--;
      else if (o.kind === "duplicado_exato") deltas.duplicados_exatos_fundidos--;
      else if (o.kind === "kept_separate") deltas.mantidas_separadas--;
      else if (o.kind === "flagged") deltas.sinalizadas_revisao--;
        }
    deltas.erros++;
    return {
      deltas,
      upsertedIds,
      linha: {
          linha: linhaNumero,
          comprador: nome,
          consultor: consultorLabel,
          resultado: "Erro",
          motivo: anyError.reason,
      },
    };
      }
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
  return {
    deltas,
    upsertedIds,
    linha: {
        linha: linhaNumero,
        comprador: nome,
        consultor: consultorLabel,
        resultado: label,
        motivo,
    },
  };
}

// ---------------------------------------------------------------------------
// Release 1.2.4 — API em três passos para permitir barra de progresso real:
//   1) startExcelImport      → parse + auto-deteção de cabeçalhos
//   2) processExcelChunk     → processa N linhas (repetido pelo cliente)
//   3) finalizeExcelImport   → corre o Motor Match em lote
// ---------------------------------------------------------------------------

const StartInput = z.object({ fileBase64: z.string().min(10), filename: z.string().optional() });

export type StartExcelImportResult = {
  batch_id: string;
  expires_at: string;
  header_row: number; // 1-indexed para leitura humana
  total: number;
  rows: PreparedExcelRow[];
};

export const startExcelImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => StartInput.parse(data))
  .handler(async ({ data }): Promise<StartExcelImportResult> => {
    const { rows, headerIndex } = parseWorkbookRows(data.fileBase64);
    const batch_id = `xlsx_${Date.now()}`;
    const expires = new Date(Date.now() + DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    return {
      batch_id,
      expires_at: expires,
      header_row: headerIndex + 1,
      total: rows.length,
      rows,
    };
  });

const ChunkInput = z.object({
  batch_id: z.string().min(1),
  expires_at: z.string().min(1),
  rows: z.array(
    z.object({
      linha: z.number(),
      data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    }),
  ),
});

export type ProcessExcelChunkResult = {
  counters: ChunkCounters;
  linhas: ExcelImportResult["linhas"];
  upsertedIds: string[];
};

export const processExcelChunk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ChunkInput.parse(data))
  .handler(async ({ data, context }): Promise<ProcessExcelChunkResult> => {
    const { supabase, userId } = context;
    const geoSnap = await LocationRepository.getSnapshot();
    const counters: ChunkCounters = {
      novas: 0,
      atualizadas: 0,
      duplicados_exatos_fundidos: 0,
      mantidas_separadas: 0,
      sinalizadas_revisao: 0,
      ignoradas_sem_contacto: 0,
      descartadas_anuncio: 0,
      erros: 0,
    };
    const linhas: ExcelImportResult["linhas"] = [];
    const upsertedIds: string[] = [];
    for (const pre of data.rows) {
      try {
        const res = await processOneRow(
          supabase,
          userId,
          pre.data,
          pre.linha,
          data.batch_id,
          data.expires_at,
          geoSnap,
        );
        for (const k of Object.keys(counters) as (keyof ChunkCounters)[]) {
          counters[k] += res.deltas[k];
        }
        linhas.push(res.linha);
        upsertedIds.push(...res.upsertedIds);
      } catch (e) {
        counters.erros++;
        linhas.push({
          linha: pre.linha,
          comprador: null,
          consultor: null,
          resultado: "Erro",
          motivo: e instanceof Error ? e.message : "Erro desconhecido",
        });
      }
    }
    return { counters, linhas, upsertedIds };
  });

const FinalizeInput = z.object({ batch_id: z.string().min(1) });

export type FinalizeExcelImportResult = {
  matches: number;
  removidas: number;
};

export const finalizeExcelImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => FinalizeInput.parse(data))
  .handler(async ({ data, context }): Promise<FinalizeExcelImportResult> => {
    const { supabase, userId } = context;
    const { data: batchSearches } = await supabase
      .from("active_searches")
      .select("id")
      .eq("user_id", userId)
      .eq("import_batch_id", data.batch_id);
    const searchIds = (batchSearches ?? []).map((r: any) => r.id as string);
    let matches = 0;
    try {
      const { matchesBySearch } = await recomputeForBatch(supabase, userId, searchIds);
      const nowIso = new Date().toISOString();
      const withMatches: string[] = [];
      for (const [sid, n] of matchesBySearch) {
        matches += n;
        if (n > 0) withMatches.push(sid);
      }
      if (withMatches.length) {
        await supabase
          .from("active_searches")
          .update({ last_match_at: nowIso })
          .in("id", withMatches);
      }
    } catch (e) {
      console.error("excel: recomputeForBatch failed", e);
    }
    return { matches, removidas: 0 };
  });
