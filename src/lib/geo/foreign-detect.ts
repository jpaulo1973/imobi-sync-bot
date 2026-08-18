/**
 * Item 4 — deteção de procuras cuja localização está fora de Portugal.
 *
 * O motor de match só cobre a biblioteca geográfica portuguesa (CAOP), pelo
 * que procuras para outros países nunca resolvem e ficam eternamente na fila
 * de revisão. Este detetor sinaliza-as para que o administrador as possa
 * descartar (soft-delete), com confirmação explícita — nunca apaga nada
 * automaticamente.
 *
 * Regras: só sinaliza com marcadores fortes e inequívocos. Termos ambíguos
 * que também existem em Portugal (ex. "Marina", "Palma", "Oasis") ficam
 * deliberadamente de fora para evitar falsos positivos.
 */

export type ForeignHint = { country: string; marker: string };

const RULES: Array<{ country: string; pattern: RegExp }> = [
  {
    country: "Emirados Árabes Unidos",
    pattern:
      /\b(dubai|damac|jebel\s*ali|jumeirah|jumeira|jbr|jvc|jvt|arjan|sharjah|ajman|abu\s*dhabi|emirados\s+árabes|emirates\s+(city|cluster|beachfront)|ras\s+al\s+khaimah|fujairah|khorfakkan|business\s+bay|creek\s+harbou?r|dubailand|al[-\s]furjan|silicon\s+oasis|sheikh\s+zayed|emaar|barsha|arabian\s+ranches|motor\s?city|studio\s+city|sports\s+city|production\s+city|expo\s+city|bur\s+dubai|al\s+quoz|nuaimiya|deira|mirdif|warsan|majan|al\s+hayl)\b/i,
  },
  { country: "Arábia Saudita", pattern: /\b(riyadh|riade|jeddah|jidá|dammam|khobar)\b/i },
  { country: "Catar", pattern: /\b(doha|qatar|catar)\b/i },
  { country: "Brasil", pattern: /\b(são\s+paulo\s*[-/,]\s*sp|rio\s+de\s+janeiro|florianópolis|balneário\s+cambori[uú])\b/i },
  { country: "Espanha", pattern: /\b(madrid|barcelona|marbella|málaga|sevilha|valência\s*,?\s*espanha|costa\s+del\s+sol|ilhas\s+canárias|tenerife|maiorca)\b/i },
  { country: "Estados Unidos", pattern: /\b(miami|new\s+york|nova\s+iorque|orlando|los\s+angeles|texas|florida)\b/i },
  { country: "Reino Unido", pattern: /\b(london|londres|manchester)\b/i },
  { country: "Cabo Verde", pattern: /\b(cabo\s+verde|sal\s+rei|santa\s+maria\s*,?\s*sal|mindelo|praia\s*,?\s*santiago)\b/i },
  { country: "Angola", pattern: /\b(luanda|benguela|talatona)\b/i },
];

/** Devolve o país/marcador detetado, ou `null` se o texto não é claramente estrangeiro. */
export function detectForeignLocation(...texts: Array<string | null | undefined>): ForeignHint | null {
  const blob = texts.filter(Boolean).join(" \n ");
  if (!blob.trim()) return null;
  for (const rule of RULES) {
    const m = rule.pattern.exec(blob);
    if (m) return { country: rule.country, marker: m[0] };
  }
  return null;
}
