// Contexto geográfico — utilitário puro para normalização determinística
// de texto. Não depende de I/O nem de estado global.

/**
 * Normalização canónica: remove diacríticos, colapsa espaços, minúsculas,
 * trim. É a única forma de produzir chaves para lookup na biblioteca.
 */
export function normalizeGeoText(v: string | null | undefined): string {
  return (v ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^a-z0-9\s\-\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Slug: normaliza e substitui espaços por `-`. */
export function toSlug(v: string | null | undefined): string {
  return normalizeGeoText(v).replace(/\s+/g, "-");
}

/**
 * Conectores textuais que separam múltiplas localizações num único campo.
 * A ordem importa: primeiro delimitadores fortes, depois conjunções.
 */
const CONNECTORS = [
  ";",
  " / ",
  " | ",
  ",",
  " ou ",
  " e ",
  " + ",
  " & ",
];

/**
 * Divide um texto livre em segmentos candidatos a localização.
 * Determinístico. Sem heurísticas fuzzy.
 */
export function splitConnectors(input: string): string[] {
  const base = (input ?? "").trim();
  if (!base) return [];
  let parts: string[] = [base];
  for (const c of CONNECTORS) {
    const next: string[] = [];
    for (const p of parts) {
      const lowered = ` ${p.toLowerCase()} `;
      if (c.trim() && lowered.includes(c)) {
        next.push(...p.split(new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")));
      } else if (!c.trim() && p.includes(c)) {
        next.push(...p.split(c));
      } else {
        next.push(p);
      }
    }
    parts = next;
  }
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}