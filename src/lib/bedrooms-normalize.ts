// -----------------------------------------------------------------------------
// Fonte ÚNICA de normalização de tipologia / quartos_min.
//
// Toda ingestão (Excel, WhatsApp, search-splitter, extractAndMatch, property
// import, futuras APIs/conectores/PDF) DEVE passar valores brutos por aqui
// antes de gravar em base de dados ou usar em matching. Não duplicar esta
// lógica noutros módulos — se um formato novo aparecer, estender esta função
// e adicionar teste em `bedrooms-normalize.test.ts`.
//
// Regras:
//  - Formatos aceites: "T3", "t3", "T 3", "T3+", "3", "3 quartos", "5+", "Moradia".
//  - Múltiplas tipologias na mesma string ("T2 ou T3") → tipologia preservada,
//    quartos_min = mínimo.
//  - Valores implausíveis (nº quartos > MAX_PLAUSIBLE_BEDROOMS) → { null, null }
//    e emitem `console.warn` para auditoria; nunca são tratados como "73 quartos".
//  - Entradas vazias / não reconhecidas → { null, null }.
// -----------------------------------------------------------------------------

export const MAX_PLAUSIBLE_BEDROOMS = 20;

export type NormalizedBedrooms = {
  tipologia: string | null;
  quartos_min: number | null;
};

function warnImplausible(raw: unknown, value: number, source: string) {
  console.warn(
    `[bedrooms-normalize] valor implausível ignorado (source=${source}): raw=${JSON.stringify(raw)} → ${value} quartos`,
  );
}

function coerceNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Normaliza uma tipologia bruta ("T3", "3", "3 quartos", "T2 ou T3", …).
 * Devolve sempre `{ tipologia, quartos_min }` — nunca lança.
 */
export function normalizeBedrooms(raw: unknown, source = "unknown"): NormalizedBedrooms {
  if (raw == null) return { tipologia: null, quartos_min: null };
  const original = String(raw).trim();
  if (!original) return { tipologia: null, quartos_min: null };

  // "Moradia" e variantes não-numéricas
  if (/^moradia$/i.test(original)) return { tipologia: "Moradia", quartos_min: null };

  // Múltiplas tipologias ("T2 ou T3", "T2/T3", "T2, T3")
  const multi = Array.from(original.matchAll(/t\s*(\d{1,2})/gi)).map((m) => Number(m[1]));
  if (multi.length >= 2) {
    const min = Math.min(...multi);
    if (min > MAX_PLAUSIBLE_BEDROOMS) {
      warnImplausible(raw, min, source);
      return { tipologia: null, quartos_min: null };
    }
    // Preserva a string original com espaçamento razoável.
    return { tipologia: original.replace(/\s+/g, " ").toUpperCase(), quartos_min: min };
  }

  // "T3", "T 3", "t3", "T3+"
  const mT = /^t\s*(\d{1,2})\s*\+?$/i.exec(original);
  if (mT) {
    const n = Number(mT[1]);
    if (n > MAX_PLAUSIBLE_BEDROOMS) {
      warnImplausible(raw, n, source);
      return { tipologia: null, quartos_min: null };
    }
    return { tipologia: `T${n}`, quartos_min: n };
  }

  // "3", "3 quartos", "5+", "3 assoalhadas"
  const mNum = /^(\d{1,3})\s*\+?\s*(quartos?|assoalhadas?)?$/i.exec(original);
  if (mNum) {
    const n = Number(mNum[1]);
    if (n > MAX_PLAUSIBLE_BEDROOMS) {
      warnImplausible(raw, n, source);
      return { tipologia: null, quartos_min: null };
    }
    return { tipologia: `T${n}`, quartos_min: n };
  }

  return { tipologia: null, quartos_min: null };
}

/**
 * Reconcilia `tipologia` + `quartos_min` vindos de um extractor (LLM, Excel,
 * splitter). `quartos_min` explícito prevalece se plausível; caso contrário
 * cai no que a normalização de `tipologia` deduzir.
 */
export function normalizeSearchBedrooms(
  input: { tipologia?: unknown; quartos_min?: unknown },
  source = "unknown",
): NormalizedBedrooms {
  const fromTip = normalizeBedrooms(input.tipologia, source);
  const explicit = coerceNumber(input.quartos_min);
  let quartos_min: number | null = fromTip.quartos_min;
  if (explicit != null) {
    if (explicit > 0 && explicit <= MAX_PLAUSIBLE_BEDROOMS) {
      quartos_min = explicit;
    } else if (explicit > MAX_PLAUSIBLE_BEDROOMS) {
      warnImplausible(input.quartos_min, explicit, `${source}:quartos_min`);
    }
  }
  return { tipologia: fromTip.tipologia, quartos_min };
}

/**
 * Sanitização defensiva usada pelo motor de matching sobre dados já em BD:
 * garante que valores implausíveis nunca eliminam matches por serem lidos
 * como "73 quartos". Nunca inventa dados — só descarta os implausíveis.
 */
export function sanitizeBedroomsCount(v: unknown, source = "matching-engine"): number | null {
  const n = coerceNumber(v);
  if (n == null) return null;
  if (n <= 0) return null;
  if (n > MAX_PLAUSIBLE_BEDROOMS) {
    warnImplausible(v, n, source);
    return null;
  }
  return n;
}