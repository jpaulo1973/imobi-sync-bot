import type { ConsultorSemTelefone } from "@/lib/review.functions";

export const REVIEW_EXPORT_HEADERS = [
  "id_linha",
  "nome",
  "telefone_atual",
  "telefone_novo",
  "email",
  "agencia",
  "procuras_afetadas",
  "search_ids",
  "exportado_em",
] as const;

export type ReviewExportRow = Record<(typeof REVIEW_EXPORT_HEADERS)[number], string | number>;

export function buildReviewRows(items: ConsultorSemTelefone[]): ReviewExportRow[] {
  const now = new Date().toISOString();
  return items.map((it) => ({
    id_linha: it.key,
    nome: it.nome ?? "",
    telefone_atual: it.telefone_bruto ?? "",
    telefone_novo: "",
    email: it.email ?? "",
    agencia: it.agency ?? "",
    procuras_afetadas: it.procuras_afetadas,
    search_ids: it.search_ids.join(";"),
    exportado_em: now,
  }));
}

export function exportFilename(ext: "csv" | "xlsx") {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `revisao-contactos-${stamp}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadReviewCsv(items: ConsultorSemTelefone[]) {
  const rows = buildReviewRows(items);
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    REVIEW_EXPORT_HEADERS.join(";"),
    ...rows.map((r) => REVIEW_EXPORT_HEADERS.map((h) => esc(r[h])).join(";")),
  ];
  triggerDownload(
    new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    exportFilename("csv"),
  );
}

export async function downloadReviewXlsx(items: ConsultorSemTelefone[]) {
  const XLSX = await import("xlsx");
  const rows = buildReviewRows(items);
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...REVIEW_EXPORT_HEADERS] });
  ws["!cols"] = [
    { wch: 24 },
    { wch: 26 },
    { wch: 16 },
    { wch: 16 },
    { wch: 28 },
    { wch: 20 },
    { wch: 8 },
    { wch: 44 },
    { wch: 22 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Revisao");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  triggerDownload(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    exportFilename("xlsx"),
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normHeader(h: string) {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const HEADER_ALIASES: Record<string, string> = {
  id_linha: "id_linha",
  id: "id_linha",
  identificador: "id_linha",
  telefone_novo: "telefone_novo",
  novo_telefone: "telefone_novo",
  telefone: "telefone_novo",
  telemovel: "telefone_novo",
  search_ids: "search_ids",
  searchids: "search_ids",
  procuras: "search_ids",
  ids_procuras: "search_ids",
  nome: "nome",
};

export type ParsedImportRow = {
  linha: number;
  id_linha: string;
  nome: string;
  search_ids: string[];
  telefone_novo: string;
  status: "pronto" | "ignorado" | "invalido";
  motivo?: string;
};

export type ParsedImportFile = {
  rows: ParsedImportRow[];
  prontos: number;
  ignorados: number;
  invalidos: number;
};

function digitsCount(s: string) {
  return (s.match(/\d/g) ?? []).length;
}

export async function parseFilledReviewFile(file: File): Promise<ParsedImportFile> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Ficheiro sem folhas de dados.");
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]!, {
    defval: "",
    raw: false,
  });
  if (raw.length === 0) throw new Error("Ficheiro sem linhas de dados.");

  const rows: ParsedImportRow[] = raw.map((original, i) => {
    const mapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(original)) {
      const key = HEADER_ALIASES[normHeader(k)];
      if (key && !mapped[key]) mapped[key] = String(v ?? "").trim();
    }
    const linha = i + 2;
    const id_linha = mapped["id_linha"] ?? "";
    const nome = mapped["nome"] ?? "";
    const telefone_novo = mapped["telefone_novo"] ?? "";
    const search_ids = (mapped["search_ids"] ?? "")
      .split(/[;,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const base = { linha, id_linha, nome, search_ids, telefone_novo };
    if (!telefone_novo) {
      return { ...base, status: "ignorado" as const, motivo: "Sem telefone_novo preenchido" };
    }
    if (search_ids.length === 0) {
      return { ...base, status: "invalido" as const, motivo: "Coluna search_ids vazia" };
    }
    if (search_ids.some((id) => !UUID_RE.test(id))) {
      return { ...base, status: "invalido" as const, motivo: "search_ids com formato inválido" };
    }
    if (digitsCount(telefone_novo) < 9) {
      return { ...base, status: "invalido" as const, motivo: "Telefone com menos de 9 dígitos" };
    }
    return { ...base, status: "pronto" as const };
  });

  return {
    rows,
    prontos: rows.filter((r) => r.status === "pronto").length,
    ignorados: rows.filter((r) => r.status === "ignorado").length,
    invalidos: rows.filter((r) => r.status === "invalido").length,
  };
}
