/**
 * Item 4a — deteção de "oferta" (anúncio de imóvel à venda) submetida como
 * procura. É um padrão recorrente nas importações Excel de grupos de WhatsApp,
 * onde a mesma folha mistura pedidos de compradores com anúncios de imóveis.
 *
 * Não apaga nem rejeita nada: devolve um sinal para (a) marcar a linha para
 * revisão na importação e (b) destacá-la na página de Revisão, onde o
 * administrador confirma e descarta.
 */

// Marcadores fortes de pedido de comprador — vencem sempre os de oferta,
// porque muitos pedidos começam por "Oportunidade de investimento" e afins.
const DEMAND = /\b(procuro|procura[-\s]?se|pretendo comprar|cliente comprador|para cliente|em nome de cliente|tenho cliente|clientes? à procura|necessito|pretende adquirir)\b/i;

const SUPPLY = [
  /\bvende[-\s]?se\b/i,
  /\b(para|em) venda\b/i,
  /\bmarque (a sua )?visita\b/i,
  /\bagende (a sua )?visita\b/i,
  /\bapresento[- ]lhe\b/i,
  /\b(imóvel|apartamento|moradia|prédio) (já )?disponível\b/i,
  /\bcertificado energético\b/i,
  /\bempreendimento\b/i,
  /\bangariei\b/i,
  /\bpartilha de 50\b/i,
];

export type OfferHint = { marker: string };

/** `null` quando o texto parece (ou pode ser) uma procura legítima. */
export function detectOfferPosing(...texts: Array<string | null | undefined>): OfferHint | null {
  const blob = texts.filter(Boolean).join(" \n ");
  if (!blob.trim()) return null;
  if (DEMAND.test(blob)) return null;
  for (const p of SUPPLY) {
    const m = p.exec(blob);
    if (m) return { marker: m[0] };
  }
  return null;
}
