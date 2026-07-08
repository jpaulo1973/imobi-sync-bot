// Utilities para deduplicar procuras (Excel + WhatsApp + texto + captura).
// Uma "procura" tem uma identidade estável construída pelo telefone normalizado
// + finalidade quando existir; caso contrário por um hash de nome+zona+tipologia.

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

function slug(v?: string | null): string {
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
