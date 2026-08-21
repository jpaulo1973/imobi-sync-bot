// Módulo puro — contagem de compradores compatíveis por imóvel.
//
// Extraído de property-match.functions.ts para ser testável em isolamento e
// para permitir calcular contagens na perspetiva do DONO REAL de cada imóvel
// (necessário na vista de Imóveis do Admin, que lista imóveis de terceiros).

import { scoreMatch, type BuyerLike, type GeoMatchIndex } from "./matching-engine";

export function criteriaToBuyer(c: any, location_ids: string[] = []): BuyerLike {
  const finalidade = c?.finalidade === "indefinido" ? undefined : c?.finalidade;
  const gar = ((c?.caracteristicas ?? []) as string[]).some((x) => /garagem/i.test(x));
  const ele = ((c?.caracteristicas ?? []) as string[]).some((x) => /elevador/i.test(x));
  return {
    finalidade,
    tipo_imovel: c?.tipo_imovel ?? null,
    tipologia: c?.tipologia ?? null,
    location_ids,
    budget_min: c?.budget_min ?? null,
    categorias: Array.isArray(c?.categorias) ? c.categorias : null,
    categoria_origem: typeof c?.categoria_origem === "string" ? c.categoria_origem : null,
    budget_max_obras: c?.budget_max_obras ?? null,
    budget_max_pronto: c?.budget_max_pronto ?? null,
    estado_desejado: c?.estado_desejado ?? null,
    budget_max: c?.budget_max ?? null,
    area_min: c?.area_min ?? null,
    quartos_min: c?.quartos_min ?? null,
    garagem_obrigatoria: gar,
    elevador_obrigatorio: ele,
    proximity: c?.proximity ?? null,
    caracteristicas: Array.isArray(c?.caracteristicas) ? c.caracteristicas : null,
  } as BuyerLike;
}

export function normDedupPhone(v: unknown): string {
  if (v == null) return "";
  let s = String(v).replace(/\D+/g, "");
  if (s.startsWith("00")) s = s.slice(2);
  if (s.startsWith("351") && s.length > 9) s = s.slice(-9);
  return s.length >= 9 ? s : "";
}

export function normDedupName(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buyerIdentityKey(
  telefone: string | null | undefined,
  nome: string | null | undefined,
  fallback: string,
): string {
  const phone = normDedupPhone(telefone);
  if (phone) return `phone:${phone}`;
  const name = normDedupName(nome);
  if (name) return `name:${name}`;
  return fallback;
}

export function dedupByIdentity<T extends { score: number }>(
  items: Array<{ identity: string; opp: T }>,
): T[] {
  const best = new Map<string, { identity: string; opp: T }>();
  for (const it of items) {
    const prev = best.get(it.identity);
    if (!prev || it.opp.score > prev.opp.score) best.set(it.identity, it);
  }
  return Array.from(best.values()).map((v) => v.opp);
}

export type CountMatchesInput = {
  /** Imóveis a contar — podem pertencer a donos diferentes. */
  properties: any[];
  /** Compradores próprios agrupados por user_id do dono. */
  buyersByOwner: Map<string, any[]>;
  /** Base Global de procuras (active_searches) — aplica-se a qualquer dono. */
  searches: any[];
  geoIndex: GeoMatchIndex;
  /**
   * Pares descartados pelo utilizador da sessão, na forma
   * `${propertyId}|${source}-${buyerRef}`. Os estados são pessoais, logo só
   * existem para os pares do próprio utilizador.
   */
  dismissed?: Set<string>;
};

/**
 * Contagem de compradores compatíveis por imóvel, na perspetiva do dono real
 * de cada imóvel: compradores próprios desse dono + toda a Base Global.
 */
export function countMatchesForProperties({
  properties,
  buyersByOwner,
  searches,
  geoIndex,
  dismissed = new Set<string>(),
}: CountMatchesInput): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of properties ?? []) {
    // Sprint 1.2.3 — contar identidades únicas por (property, buyer),
    // não linhas cruas. Aceita apenas o melhor score por identidade.
    const bestByIdentity = new Map<string, number>();
    const bump = (id: string, sc: number) => {
      const prev = bestByIdentity.get(id);
      if (prev == null || sc > prev) bestByIdentity.set(id, sc);
    };
    const ownerBuyers = buyersByOwner.get(p.user_id) ?? [];
    for (const b of ownerBuyers) {
      if (dismissed.has(`${p.id}|cliente-${b.id}`)) continue;
      const r = scoreMatch(b as BuyerLike, p as any, { geoIndex });
      if (!r.compatible) continue;
      bump(buyerIdentityKey((b as any).telefone, (b as any).nome, `cliente:${b.id}`), r.score);
    }
    for (const q of searches ?? []) {
      if (dismissed.has(`${p.id}|search-${q.id}`)) continue;
      const r = scoreMatch(
        {
          ...criteriaToBuyer(q.criteria, (q as any).location_ids ?? []),
          resumo: (q as any).resumo ?? null,
          texto_original: (q as any).texto_original ?? null,
        } as BuyerLike,
        p as any,
        { geoIndex },
      );
      if (!r.compatible) continue;
      const c = (q.criteria ?? {}) as any;
      const rawPhone =
        (typeof (q as any).contact_telefone === "string" && (q as any).contact_telefone.trim()) ||
        (typeof c?.telefone === "string" && c.telefone.trim()) ||
        null;
      const rawName =
        (typeof (q as any).contact_nome === "string" && (q as any).contact_nome.trim()) ||
        (typeof c?.nome === "string" && c.nome.trim()) ||
        null;
      bump(buyerIdentityKey(rawPhone, rawName, `search:${q.id}`), r.score);
    }
    counts[p.id] = bestByIdentity.size;
  }
  return counts;
}
