// ---------------------------------------------------------------------------
// Notificações de Match — varredura server-only.
//
// Os matches continuam efémeros (calculados na hora pelo motor existente).
// Aqui apenas registamos "já notifiquei este par cliente+imóvel" na tabela
// leve `match_notifications`, cuja unicidade (user_id, pair_key) garante
// idempotência: reprocessar não cria segunda notificação.
//
// Não altera `matching-engine.ts` nem qualquer regra de compatibilidade.
// ---------------------------------------------------------------------------
import { scoreMatch, buildGeoMatchIndex, type BuyerLike } from "./matching-engine";
import { LocationRepository } from "./geo";
import { MIN_MATCH_SCORE } from "./match-thresholds";

export type SweepResult = { created: number; evaluated: number; candidates: number };

function criteriaToBuyer(c: any, location_ids: string[] = []): BuyerLike {
  const finalidade = c?.finalidade === "indefinido" ? undefined : c?.finalidade;
  const cars = (c?.caracteristicas ?? []) as string[];
  return {
    finalidade,
    tipo_imovel: c?.tipo_imovel ?? null,
    tipologia: c?.tipologia ?? null,
    location_ids,
    budget_min: c?.budget_min ?? null,
    budget_max: c?.budget_max ?? null,
    area_min: c?.area_min ?? null,
    quartos_min: c?.quartos_min ?? null,
    garagem_obrigatoria: cars.some((x) => /garagem/i.test(String(x))),
    elevador_obrigatorio: cars.some((x) => /elevador/i.test(String(x))),
    proximity: c?.proximity ?? null,
    caracteristicas: Array.isArray(c?.caracteristicas) ? c.caracteristicas : null,
  };
}

function buyerClientToBuyerLike(b: any): BuyerLike {
  return {
    finalidade: b.finalidade ?? null,
    tipo_imovel: b.tipo_imovel ?? null,
    tipologia: b.tipologia ?? null,
    location_ids: Array.isArray(b.location_ids) ? (b.location_ids as string[]) : [],
    budget_min: b.budget_min ?? null,
    budget_max: b.budget_max ?? null,
    area_min: b.area_min ?? null,
    quartos_min: b.quartos_min ?? null,
    garagem_obrigatoria: b.garagem_obrigatoria ?? null,
    elevador_obrigatorio: b.elevador_obrigatorio ?? null,
    proximity: b.proximity ?? null,
  };
}

export function pairKey(
  buyerSource: "cliente" | "search",
  buyerRef: string,
  propertyId: string,
): string {
  return `${buyerSource}:${buyerRef}:${propertyId}`;
}

export function propertyLabel(p: any): string {
  const ref = typeof p?.referencia === "string" && p.referencia.trim() ? p.referencia.trim() : null;
  const zona = typeof p?.zona === "string" && p.zona.trim() ? p.zona.trim() : null;
  const tip = typeof p?.tipologia === "string" && p.tipologia.trim() ? p.tipologia.trim() : null;
  return [ref, tip, zona].filter(Boolean).join(" · ") || "Imóvel";
}

export function reasonSummary(reasons: string[]): string {
  return reasons.slice(0, 3).join(" · ");
}

type Candidate = {
  buyer_source: "cliente" | "search";
  buyer_ref: string;
  buyer_label: string | null;
  buyer: BuyerLike;
};

/**
 * Varre os pares relevantes para UM consultor e devolve as notificações a
 * inserir. Pares relevantes:
 *   A) imóveis do consultor  × compradores/procuras activas (Base Global)
 *   B) imóveis activos globais × compradores/procuras do próprio consultor
 */
export async function sweepForUser(
  supabase: any,
  userId: string,
): Promise<{ rows: any[]; evaluated: number; candidates: number }> {
  // Base Global via RPCs SECURITY DEFINER (sem service_role key).
  const { setRequestClient, poolProperties, poolBuyerClients, poolActiveSearches } = await import(
    "@/lib/privileged.server"
  );
  setRequestClient(supabase);
  const [properties, buyers, searches] = await Promise.all([
    poolProperties(),
    poolBuyerClients(),
    poolActiveSearches(),
  ]);

  const candidates: Candidate[] = [
    ...buyers.map((b) => ({
      buyer_source: "cliente" as const,
      buyer_ref: b.id as string,
      buyer_label: (b.nome as string) ?? null,
      buyer: buyerClientToBuyerLike(b),
      user_id: b.user_id as string,
    })),
    ...searches.map((q) => ({
      buyer_source: "search" as const,
      buyer_ref: q.id as string,
      buyer_label:
        (q.contact_nome as string) ??
        ((q.criteria as any)?.nome as string) ??
        (q.resumo as string) ??
        null,
      buyer: criteriaToBuyer(q.criteria, (q.location_ids as string[]) ?? []),
      user_id: q.user_id as string,
    })),
  ];

  const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());
  const rowsByPair = new Map<string, any>();
  let evaluated = 0;

  for (const p of properties) {
    const ownsProperty = p.user_id === userId;
    for (const c of candidates as Array<Candidate & { user_id: string }>) {
      const ownsBuyer = c.user_id === userId;
      // Só interessa ao consultor se ele é dono de um dos dois lados.
      if (!ownsProperty && !ownsBuyer) continue;
      evaluated++;
      const r = scoreMatch(c.buyer, p as any, { geoIndex });
      if (!r.compatible) continue;
      if (r.score < MIN_MATCH_SCORE) continue;
      const key = pairKey(c.buyer_source, c.buyer_ref, p.id as string);
      const prev = rowsByPair.get(key);
      if (prev && prev.score >= r.score) continue;
      rowsByPair.set(key, {
        user_id: userId,
        pair_key: key,
        buyer_source: c.buyer_source,
        buyer_ref: c.buyer_ref,
        property_id: p.id,
        buyer_label: c.buyer_label,
        property_label: propertyLabel(p),
        score: r.score,
        reason_summary: reasonSummary(r.reasons),
      });
    }
  }

  return { rows: Array.from(rowsByPair.values()), evaluated, candidates: candidates.length };
}

// ---------------------------------------------------------------------------
// Email por "onda" — preparado mas DESLIGADO.
//
// O envio exige um domínio de envio próprio configurado no projecto. Até lá,
// `MATCH_EMAIL_ENABLED` fica false: a notificação in-app é criada normalmente
// e `emailed_at` permanece nulo. Quando o domínio existir, basta ligar a flag
// e ligar o envio ao serviço de email do projecto.
// ---------------------------------------------------------------------------
export const MATCH_EMAIL_ENABLED = false;

export function buildEmailDigest(
  rows: Array<{
    buyer_label: string | null;
    property_label: string | null;
    score: number;
    reason_summary: string | null;
    property_id: string;
  }>,
  baseUrl: string,
): { subject: string; html: string } | null {
  if (rows.length === 0) return null;
  const subject =
    rows.length === 1
      ? "1 novo match no Property Match"
      : `${rows.length} novos matches no Property Match`;
  const items = rows
    .map(
      (r) =>
        `<li><strong>${r.buyer_label ?? "Comprador"}</strong> ↔ ${r.property_label ?? "Imóvel"}` +
        ` (${r.score}%)<br><small>${r.reason_summary ?? ""}</small><br>` +
        `<a href="${baseUrl}/imoveis?open=${r.property_id}">Ver match</a></li>`,
    )
    .join("");
  return { subject, html: `<h2>${subject}</h2><ul>${items}</ul>` };
}
