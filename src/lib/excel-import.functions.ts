import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as XLSX from "xlsx";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scoreMatch, type BuyerLike } from "./matching-engine";
import { buildDedupKey } from "./dedup";
import { upsertOne, type UpsertRow } from "./active-searches.functions";

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
    const upsertedIds: string[] = [];

    for (const raw of rows) {
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

      // Regra mínima: precisa de telefone OU (nome + algum critério) para ser útil
      if (!telefone && !nome) continue;

      const caracExtras: string[] = [...(caract ?? [])];
      if (elevador) caracExtras.push("elevador");
      if (garagem) caracExtras.push("garagem");

      const criteria = {
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

      const dedup_key = buildDedupKey({
        telefone,
        nome,
        finalidade,
        tipologia,
        tipo_imovel: tipoImovel,
        zona: zona ?? municipio ?? freguesia,
      });

      const row: UpsertRow = {
        dedup_key,
        criteria,
        resumo: descricao,
        texto_original: mensagem ?? descricao,
        contact_nome: nome,
        contact_telefone: telefone,
        contact_email: email,
        contact_grupo: null,
        data_publicacao: dataPub,
        expires_at: expires,
        origem: "excel",
        import_batch_id: batch_id,
      };

      try {
        const res = await upsertOne(supabase, userId, row);
        upsertedIds.push(res.id);
        if (res.action === "created") novas++;
        else atualizadas++;
      } catch (e) {
        // linha inválida — segue
        console.error("Excel row upsert failed", e);
      }
    }

    // 2) Remover procuras Excel antigas que não voltaram neste ficheiro
    let removidas = 0;
    const { data: removed, error: rmErr } = await supabase
      .from("active_searches")
      .delete()
      .eq("user_id", userId)
      .eq("origem", "excel")
      .neq("import_batch_id", batch_id)
      .select("id");
    if (!rmErr && removed) removidas = removed.length;

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
    }

    return {
      analisadas: rows.length,
      novas,
      atualizadas,
      removidas,
      matches,
      batch_id,
    };
  });
