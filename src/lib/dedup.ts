// Utilities de deduplicação de procuras.
//
// A regra "chave única por telefone" foi abandonada: o mesmo consultor usa
// frequentemente o seu telefone para vários compradores distintos. A
// deduplicação passa a ser um problema de similaridade — combina scoring
// determinístico (regras) com arbitragem por IA em zonas de incerteza.
// A função `buildDedupKey` fica apenas como *hint* para candidate lookup e
// migrações antigas — não deve ser usada como identificador único.

export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  let s = String(raw).replace(/\D+/g, "");
  if (!s) return null;
  // Remove prefixo internacional 00
  if (s.startsWith("00")) s = s.slice(2);
  // Portugal: 351XXXXXXXXX → mantém só os 9 dígitos finais
  if (s.startsWith("351") && s.length > 9) s = s.slice(-9);
  if (s.length < 6) return null;
  return s;
}

export function slug(v?: string | null): string {
  if (!v) return "";
  return String(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export type DedupInput = {
  telefone?: string | null;
  nome?: string | null;
  finalidade?: string | null;
  tipologia?: string | null;
  tipo_imovel?: string[] | string | null;
  zona?: string | null;
};

export function buildDedupKey(input: DedupInput): string {
  const fin = slug(input.finalidade) || "x";
  const phone = normalizePhone(input.telefone);
  if (phone) return `p:${phone}:${fin}`;
  const tipoArr = Array.isArray(input.tipo_imovel)
    ? input.tipo_imovel.join(",")
    : input.tipo_imovel ?? "";
  const parts = [
    slug(input.nome),
    fin,
    slug(input.tipologia),
    slug(tipoArr),
    slug(input.zona),
  ].filter(Boolean);
  return `k:${parts.join("|") || "unknown"}`;
}

// ---------------------------------------------------------------------------
// Similaridade determinística entre duas procuras (0-100)
// ---------------------------------------------------------------------------

export type SimilarityCriteria = {
  finalidade?: string | null;
  tipo_imovel?: string[] | null;
  tipologia?: string | null;
  zona?: string | null;
  freguesia?: string | null;
  municipio?: string | null;
  distrito?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  area_min?: number | null;
  quartos_min?: number | null;
  caracteristicas?: string[] | null;
};

export type SimilarityResult = {
  score: number; // 0-100 sobre pesos aplicáveis
  reasons: string[];
};

type Part = { key: string; weight: number; ok: boolean; note: string };

function locSlug(v?: string | null): string {
  return slug(v);
}

function locHit(a?: string | null, b?: string | null): boolean {
  const A = locSlug(a);
  const B = locSlug(b);
  if (!A || !B) return false;
  if (A === B) return true;
  // permite contenção ("montijo" ⊂ "montijo-samouco")
  return A.includes(B) || B.includes(A);
}

export function scoreSimilarity(
  a: SimilarityCriteria,
  b: SimilarityCriteria,
  opts?: { textA?: string | null; textB?: string | null },
): SimilarityResult {
  const parts: Part[] = [];
  const add = (key: string, weight: number, ok: boolean, note: string) =>
    parts.push({ key, weight, ok, note });

  // finalidade (peso 15)
  const fa = a.finalidade && a.finalidade !== "indefinido" ? a.finalidade : null;
  const fb = b.finalidade && b.finalidade !== "indefinido" ? b.finalidade : null;
  if (fa && fb) add("finalidade", 15, fa === fb, `${fa} vs ${fb}`);

  // tipologia (peso 15)
  if (a.tipologia && b.tipologia) {
    add(
      "tipologia",
      15,
      a.tipologia.toString().toUpperCase().trim() ===
        b.tipologia.toString().toUpperCase().trim(),
      `${a.tipologia} vs ${b.tipologia}`,
    );
  }

  // tipo_imovel (peso 15) — overlap de conjunto
  if (a.tipo_imovel?.length && b.tipo_imovel?.length) {
    const A = new Set(a.tipo_imovel.map((x) => x.toLowerCase()));
    const B = new Set(b.tipo_imovel.map((x) => x.toLowerCase()));
    const inter = [...A].some((x) => B.has(x));
    add(
      "tipo_imovel",
      15,
      inter,
      `${[...A].join(",")} vs ${[...B].join(",")}`,
    );
  }

  // localização (peso 20) — freguesia > municipio > zona
  const anyLoc =
    a.zona || b.zona || a.municipio || b.municipio || a.freguesia || b.freguesia;
  if (anyLoc) {
    const ok =
      locHit(a.freguesia, b.freguesia) ||
      locHit(a.municipio, b.municipio) ||
      locHit(a.zona, b.zona) ||
      locHit(a.zona, b.municipio) ||
      locHit(b.zona, a.municipio);
    const label = (x: SimilarityCriteria) => x.zona || x.municipio || x.freguesia || "?";
    add("localizacao", 20, ok, `${label(a)} vs ${label(b)}`);
  }

  // budget (peso 20) — comparar tetos (budget_max ou budget_min)
  const ceilA = a.budget_max ?? a.budget_min ?? null;
  const ceilB = b.budget_max ?? b.budget_min ?? null;
  if (ceilA && ceilB) {
    const ratio = Math.min(ceilA, ceilB) / Math.max(ceilA, ceilB);
    add("budget", 20, ratio >= 0.85, `${ceilA} vs ${ceilB} (r=${ratio.toFixed(2)})`);
  }

  // características (peso 5) — Jaccard
  if (a.caracteristicas?.length && b.caracteristicas?.length) {
    const A = new Set(a.caracteristicas.map((x) => x.toLowerCase()));
    const B = new Set(b.caracteristicas.map((x) => x.toLowerCase()));
    const inter = [...A].filter((x) => B.has(x)).length;
    const uni = new Set([...A, ...B]).size;
    const j = uni ? inter / uni : 0;
    add("caracteristicas", 5, j >= 0.5, `j=${j.toFixed(2)}`);
  }

  // area_min (peso 5)
  if (a.area_min && b.area_min) {
    const r = Math.min(a.area_min, b.area_min) / Math.max(a.area_min, b.area_min);
    add("area", 5, r >= 0.8, `${a.area_min} vs ${b.area_min}`);
  }

  // texto (peso 5) — Jaccard sobre tokens >3 chars
  if (opts?.textA && opts?.textB) {
    const tok = (s: string) =>
      new Set(
        s
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^\w\s]/g, " ")
          .split(/\s+/)
          .filter((t) => t.length > 3),
      );
    const A = tok(opts.textA);
    const B = tok(opts.textB);
    const inter = [...A].filter((x) => B.has(x)).length;
    const uni = new Set([...A, ...B]).size;
    const j = uni ? inter / uni : 0;
    add("texto", 5, j >= 0.4, `j=${j.toFixed(2)}`);
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  if (totalWeight === 0) return { score: 0, reasons: ["sem critérios comparáveis"] };
  const okWeight = parts.reduce((s, p) => s + (p.ok ? p.weight : 0), 0);
  const score = Math.round((okWeight / totalWeight) * 100);
  const reasons = parts.map((p) => `${p.ok ? "✓" : "✗"} ${p.key}: ${p.note}`);
  return { score, reasons };
}
