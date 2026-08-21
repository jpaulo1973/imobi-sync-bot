// ---------------------------------------------------------------------------
// Release 1.2.18 — Sugestão de telefone a partir de um ficheiro de contactos
// pessoal (vCard do Google Contacts, ou CSV do Google Contacts).
//
// PRIVACIDADE: o ficheiro é lido no browser, parseado em memória e usado só
// para gerar sugestões nesta sessão. Nada é enviado para o servidor nem
// gravado na base de dados — só o telefone que o utilizador confirmar, através
// do "Guardar" já existente.
//
// A correspondência de nome usa o MESMO critério dos Duplicados: Jaccard de
// tokens sobre texto normalizado, com o limiar único `DUPLICATE_SIM_THRESHOLD`
// (0,80). A única adaptação — documentada e testada — é o tamanho mínimo de
// token: `textJaccard` descarta tokens com <= 3 letras (afinado para textos
// longos), o que apagaria nomes como "Ana", "Rui" ou "Sá".
// ---------------------------------------------------------------------------

import { normalizePhone, normalizeTextKey } from "./dedup";
import { DUPLICATE_SIM_THRESHOLD } from "./duplicates.server";

export type ContactEntry = {
  nome: string;
  /** Telefones normalizados (>= 9 dígitos), distintos. */
  telefones: string[];
};

export type ContactsFileParse = {
  contactos: ContactEntry[];
  /** Blocos/linhas descartados por falta de nome ou de telefone válido. */
  ignorados: number;
};

// --- normalização de nome e similaridade -----------------------------------

/** Tokens de nome: normalizado, sem pontuação, tokens com >= 2 caracteres. */
export function nameTokens(v?: string | null): Set<string> {
  return new Set(
    normalizeTextKey(v ?? "")
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

/** Jaccard de tokens de nome — mesma fórmula de `textJaccard`, 0..1. */
export function nameSimilarity(a?: string | null, b?: string | null): number {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  if (normalizeTextKey(a) === normalizeTextKey(b)) return 1;
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 0;
}

export const NAME_MATCH_THRESHOLD = DUPLICATE_SIM_THRESHOLD;

// --- vCard ------------------------------------------------------------------

/** Desdobra linhas continuadas (RFC 6350: linha seguinte começa por espaço/tab). */
function unfold(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function decodeQuotedPrintable(v: string): string {
  try {
    const bytes = v
      .replace(/=\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    return bytes;
  } catch {
    return v;
  }
}

function propValue(rawParams: string, value: string): string {
  const v = value.trim();
  return /encoding=quoted-printable/i.test(rawParams) ? decodeQuotedPrintable(v) : v;
}

function nameFromN(value: string): string {
  // N:apelido;nome;meio;prefixo;sufixo
  const parts = value.split(";").map((p) => p.replace(/\\,/g, ",").trim());
  const [apelido = "", nome = "", meio = ""] = parts;
  return [nome, meio, apelido].filter(Boolean).join(" ").trim();
}

function pushPhones(target: string[], raw: string) {
  for (const piece of raw.split(/[,;]/)) {
    const tel = normalizePhone(piece);
    if (tel && tel.length >= 9 && !target.includes(tel)) target.push(tel);
  }
}

export function parseVcf(text: string): ContactsFileParse {
  const contactos: ContactEntry[] = [];
  let ignorados = 0;
  let cur: { fn: string; n: string; telefones: string[] } | null = null;

  const flush = () => {
    if (!cur) return;
    const nome = (cur.fn || cur.n).trim();
    if (nome && cur.telefones.length > 0) contactos.push({ nome, telefones: cur.telefones });
    else ignorados++;
    cur = null;
  };

  for (const line of unfold(text)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^BEGIN:VCARD$/i.test(trimmed)) {
      if (cur) flush();
      cur = { fn: "", n: "", telefones: [] };
      continue;
    }
    if (/^END:VCARD$/i.test(trimmed)) {
      flush();
      continue;
    }
    if (!cur) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    const left = trimmed.slice(0, colon);
    const value = trimmed.slice(colon + 1);
    const semi = left.indexOf(";");
    const prop = (semi < 0 ? left : left.slice(0, semi)).replace(/^item\d+\./i, "").toUpperCase();
    const params = semi < 0 ? "" : left.slice(semi + 1);
    if (prop === "FN") cur.fn = propValue(params, value);
    else if (prop === "N") cur.n = nameFromN(propValue(params, value));
    else if (prop === "TEL") pushPhones(cur.telefones, propValue(params, value));
  }
  flush();
  return { contactos: mergeByName(contactos), ignorados };
}

// --- CSV do Google Contacts -------------------------------------------------

function normHeader(h: string) {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Recebe as linhas já convertidas em objetos (cabeçalho → valor). Mapeia
 * `First/Middle/Last Name` (fallback a `Name`) e todas as colunas
 * `Phone N - Value` (o Google separa múltiplos números por ":::").
 */
export function parseContactsCsvRows(rows: Array<Record<string, unknown>>): ContactsFileParse {
  const contactos: ContactEntry[] = [];
  let ignorados = 0;
  for (const row of rows) {
    let first = "";
    let middle = "";
    let last = "";
    let full = "";
    const telefones: string[] = [];
    for (const [k, v] of Object.entries(row)) {
      const h = normHeader(k);
      const val = String(v ?? "").trim();
      if (!val) continue;
      if (h === "first name" || h === "given name") first ||= val;
      else if (h === "middle name" || h === "additional name") middle ||= val;
      else if (h === "last name" || h === "family name") last ||= val;
      else if (h === "name" || h === "display name" || h === "full name") full ||= val;
      else if (/^phone \d+ value$/.test(h) || h === "phone value" || h === "phone") {
        for (const piece of val.split(":::")) pushPhones(telefones, piece);
      }
    }
    const nome = [first, middle, last].filter(Boolean).join(" ").trim() || full;
    if (nome && telefones.length > 0) contactos.push({ nome, telefones });
    else ignorados++;
  }
  return { contactos: mergeByName(contactos), ignorados };
}

/** Junta entradas com o mesmo nome normalizado (telefones acumulados). */
function mergeByName(list: ContactEntry[]): ContactEntry[] {
  const map = new Map<string, ContactEntry>();
  for (const c of list) {
    const key = normalizeTextKey(c.nome);
    const prev = map.get(key);
    if (prev) {
      for (const t of c.telefones) if (!prev.telefones.includes(t)) prev.telefones.push(t);
    } else {
      map.set(key, { nome: c.nome, telefones: [...c.telefones] });
    }
  }
  return [...map.values()];
}

/** Lê um ficheiro .vcf ou .csv escolhido pelo utilizador (browser). */
export async function parseContactsFile(file: File): Promise<ContactsFileParse> {
  const name = file.name.toLowerCase();
  const text = await file.text();
  if (name.endsWith(".vcf") || /BEGIN:VCARD/i.test(text.slice(0, 2000))) {
    const parsed = parseVcf(text);
    if (parsed.contactos.length === 0 && parsed.ignorados === 0)
      throw new Error("Ficheiro vCard sem contactos legíveis.");
    return parsed;
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.read(text, { type: "string", raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Ficheiro sem linhas de dados.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]!, {
    defval: "",
    raw: false,
  });
  const parsed = parseContactsCsvRows(rows);
  if (parsed.contactos.length === 0 && parsed.ignorados === 0)
    throw new Error("Ficheiro sem contactos legíveis (nome + telefone).");
  return parsed;
}

// --- sugestões --------------------------------------------------------------

export type SuggestTargetGroup = {
  key: string;
  nome: string | null;
  procuras_afetadas: number;
};

export type Suggestion = {
  key: string;
  nome_atual: string | null;
  status: "exato" | "parecido" | "ambiguo" | "sem_sugestao";
  telefone: string | null;
  contacto_nome: string | null;
  score: number;
  procuras_afetadas: number;
  motivo?: string;
  candidatos?: string[];
};

/**
 * Calcula sugestões para os grupos "Sem telefone". Não grava nada.
 * Ambíguo quando: o contacto tem >1 telefone distinto, há empate entre
 * contactos, ou dois grupos competem pelo mesmo contacto.
 */
export function buildSuggestions(
  grupos: SuggestTargetGroup[],
  contactos: ContactEntry[],
): Suggestion[] {
  const pre: Suggestion[] = grupos.map((g) => {
    let best = 0;
    let bestList: ContactEntry[] = [];
    for (const c of contactos) {
      const s = nameSimilarity(g.nome, c.nome);
      if (s < NAME_MATCH_THRESHOLD) continue;
      if (s > best + 1e-9) {
        best = s;
        bestList = [c];
      } else if (Math.abs(s - best) <= 1e-9) {
        bestList.push(c);
      }
    }
    const base = {
      key: g.key,
      nome_atual: g.nome,
      procuras_afetadas: g.procuras_afetadas,
      score: Math.round(best * 100) / 100,
    };
    if (bestList.length === 0)
      return { ...base, score: 0, status: "sem_sugestao", telefone: null, contacto_nome: null };
    if (bestList.length > 1)
      return {
        ...base,
        status: "ambiguo",
        telefone: null,
        contacto_nome: null,
        motivo: "Vários contactos com o mesmo grau de correspondência",
        candidatos: bestList.map((c) => c.nome),
      };
    const c = bestList[0]!;
    if (c.telefones.length > 1)
      return {
        ...base,
        status: "ambiguo",
        telefone: null,
        contacto_nome: c.nome,
        motivo: "O contacto tem mais do que um telefone",
        candidatos: c.telefones,
      };
    return {
      ...base,
      status: best >= 1 ? "exato" : "parecido",
      telefone: c.telefones[0]!,
      contacto_nome: c.nome,
    };
  });

  // Dois grupos distintos a competir pelo mesmo contacto → ambos ambíguos.
  const porContacto = new Map<string, Suggestion[]>();
  for (const s of pre) {
    if (s.status !== "exato" && s.status !== "parecido") continue;
    const k = normalizeTextKey(s.contacto_nome);
    if (!porContacto.has(k)) porContacto.set(k, []);
    porContacto.get(k)!.push(s);
  }
  for (const [, list] of porContacto) {
    if (list.length < 2) continue;
    for (const s of list) {
      s.status = "ambiguo";
      s.motivo = "Mais do que uma procura concorre pelo mesmo contacto";
      s.candidatos = list.map((x) => x.nome_atual ?? "(sem nome)");
      s.telefone = null;
    }
  }
  return pre;
}

export function summarizeSuggestions(sugestoes: Suggestion[]) {
  return {
    exatos: sugestoes.filter((s) => s.status === "exato").length,
    parecidos: sugestoes.filter((s) => s.status === "parecido").length,
    ambiguos: sugestoes.filter((s) => s.status === "ambiguo").length,
    sem_sugestao: sugestoes.filter((s) => s.status === "sem_sugestao").length,
  };
}
