// Normalização determinística aplicada a leads/procuras extraídas de
// conversas WhatsApp ANTES de qualquer persistência.
//
// Missão: garantir que a qualidade dos dados que chegam ao motor de
// matching é a mais alta possível, sem depender exclusivamente da IA.
// Estas heurísticas são conservadoras: só devolvem um valor quando o
// sinal é inequívoco. Em caso de dúvida devolvem null e deixam o campo
// original intacto.
//
// Alinhado com a correção crítica da ingestão WhatsApp:
//   1) finalidade nunca deve ficar "indefinido" quando o texto o permite
//      determinar (ver inferFinalidadeFromText).

export type InferredFinalidade = "venda" | "arrendamento";

const RENT_KEYWORDS = [
  "arrend",       // arrendar, arrendamento
  "arrenda",
  "alug",         // alugar, aluguer
  "renda",
  "mensalidade",
  "para arrend",
  "pretende arrend",
  "procura arrend",
  "quero arrend",
  "quer arrend",
  "arrendar",
  "arrendatario",
  "arrendatária",
];

const BUY_KEYWORDS = [
  "compra",       // comprar, compra
  "comprar",
  "aquisi",       // aquisição
  "adquir",       // adquirir
  "investi",      // investimento, investir
  "credito habitacao",
  "crédito habitação",
  "crédito à habitação",
  "para compra",
  "aprovado para credito",
  "aprovado para crédito",
];

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Tenta inferir a finalidade de uma procura a partir do texto original
 * e de sinais estruturados (ex.: orçamento máximo).
 *
 * Regras:
 *  - "arrendar/alugar/renda/mensalidade/…" → arrendamento.
 *  - "comprar/aquisição/crédito habitação/investir/…" → venda.
 *  - "€/mês", "por mês", "mensal" → arrendamento.
 *  - Orçamento máximo <= 10 000 € (sem outro sinal) → arrendamento.
 *  - Orçamento máximo >= 50 000 € (sem outro sinal) → venda.
 *
 * Devolve null quando não há sinal claro (permanece "indefinido").
 */
export function inferFinalidadeFromText(
  text: string | null | undefined,
  ctx: { budget_max?: number | null } = {},
): InferredFinalidade | null {
  const raw = (text ?? "").toString();
  const norm = stripDiacritics(raw).toLowerCase();

  const hasRentKeyword = RENT_KEYWORDS.some((k) => norm.includes(stripDiacritics(k).toLowerCase()));
  const hasBuyKeyword = BUY_KEYWORDS.some((k) => norm.includes(stripDiacritics(k).toLowerCase()));

  // Padrões inequívocos de renda mensal no texto.
  const monthlyPattern = /(€\s*\/?\s*m[êe]s|\/\s*m[êe]s|por\s+m[êe]s|mensal(?:idade)?|renda\s+de)/i;
  const hasMonthlySignal = monthlyPattern.test(raw);

  if (hasRentKeyword || hasMonthlySignal) {
    // Se houver sinais contraditórios, dá prioridade ao mais específico.
    if (hasBuyKeyword && !hasMonthlySignal && !hasRentKeyword) return "venda";
    return "arrendamento";
  }

  if (hasBuyKeyword) return "venda";

  // Sinal por orçamento — só quando o intervalo é claramente típico.
  const budget = typeof ctx.budget_max === "number" ? ctx.budget_max : null;
  if (budget != null) {
    if (budget > 0 && budget <= 10_000) return "arrendamento";
    if (budget >= 50_000) return "venda";
  }

  return null;
}