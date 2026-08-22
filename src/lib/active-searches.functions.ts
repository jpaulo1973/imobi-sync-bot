import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminContext, isAdminContext } from "./admin-guard.server";
import { scoreMatch, buildGeoMatchIndex, type BuyerLike } from "./matching-engine";
import {
  buildDedupKey,
  normalizePhone,
  normalizeTextKey,
  scoreSimilarity,
  textJaccard,
  type SimilarityCriteria,
} from "./dedup";
import { normContactName, saveContact } from "./contacts.server";
import { LocationRepository } from "./geo";
import { extractProximityCriteria } from "./search-splitter.server";
import { inferFinalidadeFromText } from "./whatsapp-ingestion-normalize";
import { expiresFromBase } from "./expiry";
import { shouldRenewOnMerge, renewalPatch } from "./import-batch";
import { readImportBatch } from "./import-batch-registry";
import { withInferredCategories } from "./category-infer";

const CriteriaSchema = z.object({
  nome: z.string().nullable().optional(),
  finalidade: z.enum(["venda", "arrendamento", "indefinido"]).default("indefinido"),
  tipo_imovel: z.array(z.string()).nullable().optional(),
  tipologia: z.string().nullable().optional(),
  zona: z.string().nullable().optional(),
  budget_min: z.number().nullable().optional(),
  budget_max: z.number().nullable().optional(),
  area_min: z.number().nullable().optional(),
  quartos_min: z.number().nullable().optional(),
  caracteristicas: z.array(z.string()).nullable().optional(),
  freguesia: z.string().nullable().optional(),
  municipio: z.string().nullable().optional(),
  distrito: z.string().nullable().optional(),
  area_terreno_min: z.number().nullable().optional(),
  wc_min: z.number().nullable().optional(),
  proximity: z
    .array(z.object({ poi: z.string(), minutes: z.number().int().positive() }))
    .nullable()
    .optional(),
  // Release 1.2.12 — categoria de topo + auditoria da decisão.
  categorias: z.array(z.string()).nullable().optional(),
  categoria_origem: z.string().nullable().optional(),
});

export type ActiveSearchCriteria = z.infer<typeof CriteriaSchema>;

const SaveInput = z.object({
  criteria: CriteriaSchema,
  resumo: z.string().nullable().optional(),
  texto_original: z.string().nullable().optional(),
  contact_nome: z.string().nullable().optional(),
  contact_telefone: z.string().nullable().optional(),
  contact_email: z.string().nullable().optional(),
  contact_grupo: z.string().nullable().optional(),
  data_publicacao: z.string().nullable().optional(),
  duration_days: z.number().int().min(1).max(60).default(14),
  origem: z.enum(["excel", "whatsapp", "texto", "captura"]).default("whatsapp"),
  // Release 1.2 — metadados de contexto da oportunidade
  consultor_nome: z.string().nullable().optional(),
  consultor_telefone: z.string().nullable().optional(),
  data_origem: z.string().nullable().optional(),
  hora_origem: z.string().nullable().optional(),
  grupo_whatsapp: z.string().nullable().optional(),
  comunidade: z.string().nullable().optional(),
  // Release 1.2.7 — impressão digital da conversa/ficheiro de origem.
  batch_key: z.string().nullable().optional(),
});

export const saveActiveSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SaveInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminContext(context);
    const { supabase, userId } = context;
    const expires = new Date(Date.now() + data.duration_days * 24 * 60 * 60 * 1000).toISOString();
    // Correções 1.3: normalizar telefones ANTES da persistência para que
    // exista um único formato interno (9 dígitos PT / E.164-lite).
    const contactPhoneNorm = normalizePhone(data.contact_telefone) ?? null;
    const consultorPhoneNorm = normalizePhone(data.consultor_telefone) ?? null;

    // Correção crítica ingestão WhatsApp (Fase 3+):
    // 1) Se o LLM devolveu finalidade="indefinido" mas o texto original
    //    permite inferi-la, corrigimos ANTES de persistir. Nunca gravar
    //    "indefinido" quando o texto o determina.
    // 2) Resolver location_ids via LocationRepository ANTES de gravar,
    //    para que uma zona reconhecível nunca fique com {}.
    const criteria = { ...data.criteria };
    if (criteria.finalidade === "indefinido") {
      const inferred = inferFinalidadeFromText(
        data.texto_original ?? data.resumo ?? null,
        { budget_max: criteria.budget_max ?? null },
      );
      if (inferred) criteria.finalidade = inferred;
    }

    const geoCandidate: { text: string; field: "zona" | "concelho" | "freguesia" } | null =
      criteria.zona
        ? { text: criteria.zona, field: "zona" }
        : criteria.municipio
          ? { text: criteria.municipio, field: "concelho" }
          : criteria.freguesia
            ? { text: criteria.freguesia, field: "freguesia" }
            : null;
    const zonaText = geoCandidate?.text ?? null;
    let resolvedLocationIds: string[] = [];
    let zonaUnresolved = false;
    let geoEnrichReason: string | null = null;
    try {
      const snap = await LocationRepository.getSnapshot();
      const { parseLocations } = await import("./geo");
      if (geoCandidate) {
        const parseRes = parseLocations(geoCandidate.text, snap, { field: geoCandidate.field });
        resolvedLocationIds = parseRes.resolved;
        zonaUnresolved = parseRes.resolved.length === 0;
      }
      // B2 — a cascata acima só olha para um campo estruturado. Quando o
      // resultado é vazio ou só a nível distrito, enriquecer a partir do
      // texto original; divergência/baixa confiança vão para revisão.
      const soDistrito =
        resolvedLocationIds.length === 0 ||
        resolvedLocationIds.every((id) => snap.byId.get(id)?.tipo === "distrito");
      if (soDistrito) {
        const { enrichRecordGeo } = await import("./geo/geo-enrich-from-text");
        const en = enrichRecordGeo(
          {
            fields: {
              distrito: (criteria as any).distrito ?? null,
              concelho: (criteria as any).municipio ?? null,
              freguesia: (criteria as any).freguesia ?? null,
              zona: (criteria as any).zona ?? null,
            },
            texto: data.texto_original ?? data.resumo ?? null,
            current_ids: resolvedLocationIds,
          },
          snap,
        );
        if (en.classe === "preenche") {
          resolvedLocationIds = en.location_ids;
          zonaUnresolved = false;
        } else if (en.classe === "divergencia" || en.classe === "baixa_confianca") {
          geoEnrichReason = `geo_revisao (${en.classe}): ${en.motivo ?? ""}`.trim();
        }
      }
    } catch (e) {
      console.error("[saveActiveSearch] location resolution failed", e);
    }


    // Release 1.2.12 — decidir a categoria (determinístico, sem LLM) antes de
    // persistir. Nunca sobrepõe `categorias` já presentes no input.
    const withCats = withInferredCategories(criteria as Record<string, unknown>, {
      texto_original: data.texto_original ?? null,
      resumo: data.resumo ?? null,
    });
    (criteria as any).categorias = withCats.categorias;
    (criteria as any).categoria_origem = withCats.categoria_origem;

    const dedup_key = buildDedupKey({
      telefone: contactPhoneNorm,
      nome: data.contact_nome ?? data.criteria.nome ?? null,
      finalidade: criteria.finalidade,
      tipologia: criteria.tipologia ?? null,
      tipo_imovel: criteria.tipo_imovel ?? null,
      zona: criteria.zona ?? null,
    });
    // Release 1.2.7 (corrigido) — o lote já foi REGISTADO no momento da análise
    // da conversa; aqui apenas LEMOS o estado. Assim gravar vários leads da
    // mesma conversa não incrementa o contador nem invalida a renovação, e
    // reanalisar a mesma conversa mais tarde nunca volta a renovar.
    const batch = data.batch_key
      ? await readImportBatch(supabase, data.batch_key)
      : { batchKey: "", timesSeen: 0, renewable: false };
    const res = await upsertOne(supabase, userId, {
      dedup_key,
      criteria,
      resumo: data.resumo ?? null,
      texto_original: data.texto_original ?? null,
      contact_nome: data.contact_nome ?? null,
      contact_telefone: contactPhoneNorm,
      contact_email: data.contact_email ?? null,
      contact_grupo: data.contact_grupo ?? null,
      data_publicacao: data.data_publicacao ?? null,
      expires_at: expires,
      origem: data.origem,
      import_batch_id: null,
      consultor_nome: data.consultor_nome ?? null,
      consultor_telefone: consultorPhoneNorm,
      data_origem: data.data_origem ?? null,
      hora_origem: data.hora_origem ?? null,
      grupo_whatsapp: data.grupo_whatsapp ?? data.contact_grupo ?? null,
      comunidade: data.comunidade ?? null,
      location_ids: resolvedLocationIds,
      batch_key: batch.batchKey || null,
      batch_renewable: batch.renewable,
    });
    // Release 1.1: sempre que entra uma procura ativa, cruzar imediatamente
    // com todos os imóveis ativos e materializar oportunidades novas.
    try {
      await recomputeForSearch(supabase, userId, res.id);
    } catch (e) {
      console.error("recomputeForSearch failed", e);
    }
    // Fase 3 — zona textual que o parser não conseguiu resolver deve ir
    // para Revisão. location_ids já foram gravados atomicamente acima.
    const flagReason =
      zonaText && zonaUnresolved ? `zona_desconhecida: "${zonaText}"` : geoEnrichReason;
    if (flagReason) {
      try {
        await supabase
          .from("active_searches")
          .update({
            flagged_for_review: true,
            decision_reason: flagReason.slice(0, 900),
          })
          .eq("id", res.id)
          .eq("user_id", userId);
      } catch (e) {
        console.error("[saveActiveSearch] flag zona_desconhecida failed", e);
      }
    }

    return {
      id: res.id,
      expires_at: res.expires_at,
      action: res.action,
      similarity: res.similarity,
      flagged_for_review: res.flagged_for_review,
    };
  });

// Helper interno partilhado entre saveActiveSearch e a server fn pública.
async function recomputeForSearch(supabase: any, _userId: string, searchId: string): Promise<number> {
  // Base Global: materializa oportunidades para TODOS os imóveis
  // (independentemente do dono) através de RPCs SECURITY DEFINER — sem
  // service_role key, para funcionar em qualquer host.
  const { setRequestClient, poolActiveSearches, poolProperties, applyMatchOpportunities } =
    await import("@/lib/privileged.server");
  setRequestClient(supabase);

  const searches = await poolActiveSearches({ includeExpired: true });
  const s = searches.find((row: any) => row.id === searchId);
  if (!s) return 0;
  const props = await poolProperties();
  const buyer = criteriaToBuyer(s.criteria as ActiveSearchCriteria, (s as any).location_ids ?? []);
  const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());

  const rows: Array<{
    user_id: string;
    property_id: string;
    active_search_id: string;
    score: number;
    reasons: string[];
    categories: any;
  }> = [];
  for (const p of props) {
    const r = scoreMatch(buyer, p as any, { geoIndex });
    if (!r.compatible || r.score < 60) continue;
    rows.push({
      user_id: (p as any).user_id,
      property_id: (p as any).id,
      active_search_id: s.id,
      score: r.score,
      reasons: r.reasons,
      categories: r.categories as any,
    });
  }
  return applyMatchOpportunities(rows);
}

export { recomputeForSearch };

/**
 * Batch equivalente ao `recomputeForSearch`, mas processa várias procuras
 * numa única passagem, reutilizando o `GeoSnapshot`/`GeoMatchIndex` e as
 * queries de `properties`/`match_opportunities` carregadas apenas uma vez.
 *
 * Mantém exatamente o mesmo comportamento funcional (mesmas condições de
 * aceitação, mesmos inserts/updates em `match_opportunities`) — o objetivo
 * é apenas eliminar o gargalo N×(3 queries + rebuild geoIndex) das
 * importações em lote.
 */
export async function recomputeForBatch(
  supabase: any,
  _userId: string,
  searchIds: string[],
): Promise<{ created: number; matchesBySearch: Map<string, number> }> {
  const matchesBySearch = new Map<string, number>();
  if (!searchIds.length) return { created: 0, matchesBySearch };

  const { setRequestClient, poolActiveSearches, poolProperties, applyMatchOpportunities } =
    await import("@/lib/privileged.server");
  setRequestClient(supabase);
  const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());

  const wanted = new Set(searchIds);
  const [allSearches, props] = await Promise.all([
    poolActiveSearches({ includeExpired: true }),
    poolProperties(),
  ]);
  const searches = allSearches.filter((row: any) => wanted.has(row.id));

  const rows: Array<{
    user_id: string;
    property_id: string;
    active_search_id: string;
    score: number;
    reasons: string[];
    categories: any;
  }> = [];

  for (const s of searches as any[]) {
    const buyer = criteriaToBuyer(
      s.criteria as ActiveSearchCriteria,
      (s.location_ids ?? []) as string[],
    );
    let count = 0;
    for (const p of props as any[]) {
      const r = scoreMatch(buyer, p, { geoIndex });
      if (!r.compatible || r.score < 60) continue;
      count++;
      rows.push({
        user_id: p.user_id,
        property_id: p.id,
        active_search_id: s.id,
        score: r.score,
        reasons: r.reasons,
        categories: r.categories as any,
      });
    }
    matchesBySearch.set(s.id, count);
  }

  // Um único RPC por bloco: insere o que falta e atualiza scores alterados.
  const created = await applyMatchOpportunities(rows);
  return { created, matchesBySearch };
}

// Release 1.2 — quando um imóvel é criado/atualizado, materializa
// oportunidades cruzando com a Base Global de procuras (via admin).
export async function recomputeForProperty(
  propertyId: string,
  supabase?: any,
): Promise<number> {
  const { setRequestClient, poolActiveSearches, poolProperties, applyMatchOpportunities } =
    await import("@/lib/privileged.server");
  if (supabase) setRequestClient(supabase);

  const props = await poolProperties();
  const p = props.find((row: any) => row.id === propertyId);
  if (!p) return 0;
  const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());
  const searches = await poolActiveSearches();

  const rows: Array<{
    user_id: string;
    property_id: string;
    active_search_id: string;
    score: number;
    reasons: string[];
    categories: any;
  }> = [];
  for (const s of searches as any[]) {
    const buyer = criteriaToBuyer(s.criteria as ActiveSearchCriteria, (s.location_ids ?? []) as string[]);
    const r = scoreMatch(buyer, p as any, { geoIndex });
    if (!r.compatible || r.score < 60) continue;
    rows.push({
      user_id: (p as any).user_id,
      property_id: (p as any).id,
      active_search_id: s.id,
      score: r.score,
      reasons: r.reasons,
      categories: r.categories as any,
    });
  }
  return applyMatchOpportunities(rows);
}

// Server fn callable from the client after saving a property.
export const recomputeOpportunitiesForProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ propertyId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Confirmar posse (RLS) antes de tocar via admin.
    const { data: p } = await supabase
      .from("properties")
      .select("id")
      .eq("id", data.propertyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!p) return { created: 0 };
    const created = await recomputeForProperty(data.propertyId, supabase);
    return { created };
  });

// ---------------------------------------------------------------------------
// Deduplicação inteligente — usada por Excel + WhatsApp + texto + captura.
//
// Algoritmo:
// 1) Procurar candidatos (mesmo telefone normalizado, dentro do user).
// 2) Calcular score determinístico (0-100) contra cada candidato.
// 3) Decidir:
//    - score >= 95 → duplicado exato → UPDATE
//    - 80-94       → chamar IA → update | new | review
//    - < 80        → nova procura
// 4) Em qualquer inserção guarda o motivo em `decision_reason` para auditoria.
// ---------------------------------------------------------------------------

export type UpsertRow = {
  dedup_key: string;
  criteria: Record<string, unknown>;
  resumo: string | null;
  texto_original: string | null;
  contact_nome: string | null;
  contact_telefone: string | null;
  contact_email: string | null;
  contact_grupo: string | null;
  data_publicacao: string | null;
  expires_at: string;
  origem: "excel" | "whatsapp" | "texto" | "captura";
  import_batch_id: string | null;
  consultor_nome?: string | null;
  consultor_telefone?: string | null;
  data_origem?: string | null;
  hora_origem?: string | null;
  grupo_whatsapp?: string | null;
  comunidade?: string | null;
  // Fase 3 — location_ids resolvidos pelo LocationRepository ANTES da
  // persistência. Passa a ser gravado atomicamente no INSERT, para que
  // uma procura reconhecida geograficamente nunca fique com {}.
  location_ids?: string[] | null;
  // Release 1.2.7 — identidade do FICHEIRO/LOTE (SHA-256 do conteúdo +
  // user_id) e se esse lote é genuinamente novo. Só com estes dois a fusão
  // renova a validade.
  batch_key?: string | null;
  batch_renewable?: boolean;
};

export type UpsertAction = "created" | "updated" | "kept_separate" | "flagged";

export type UpsertResult = {
  id: string;
  expires_at: string;
  action: UpsertAction;
  similarity: number;
  flagged_for_review: boolean;
  reason: string;
  /** true quando esta fusão renovou a validade por lote novo. */
  renewed?: boolean;
};

function mergeCriteria(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  if (!existing) return incoming;
  const merged: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    merged[k] = v;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Curto-circuito determinístico para duplicados verdadeiramente idênticos.
// Devolve true apenas quando existe correspondência estrita em: telefone
// normalizado, consultor (nome+telefone), nome do comprador, texto original
// e assinatura canónica dos critérios essenciais.
// ---------------------------------------------------------------------------
function normText(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "";
}
function normArr(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return [...v]
    .map((x) => normText(x))
    .filter(Boolean)
    .sort()
    .join(",");
}
function criteriaSignature(c: Record<string, unknown> | null | undefined): string {
  const x = (c ?? {}) as Record<string, unknown>;
  return JSON.stringify({
    finalidade: normText(x.finalidade) || "indefinido",
    tipologia: normText(x.tipologia),
    tipo_imovel: normArr(x.tipo_imovel),
    zona: normText(x.zona) || normText(x.municipio) || normText(x.freguesia),
    budget_min: x.budget_min ?? null,
    budget_max: x.budget_max ?? null,
    area_min: x.area_min ?? null,
    quartos_min: x.quartos_min ?? null,
    caracteristicas: normArr(x.caracteristicas),
  });
}
/** Telefone efetivo de uma linha nova: comprador primeiro, consultor a seguir. */
function effectivePhone(row: UpsertRow): string | null {
  return normalizePhone(row.contact_telefone) ?? normalizePhone(row.consultor_telefone) ?? null;
}

/** Telefone efetivo de um registo já existente. */
function effectivePhoneOf(candidate: any): string | null {
  return (
    normalizePhone(candidate?.contact_telefone) ??
    normalizePhone(candidate?.consultor_telefone) ??
    null
  );
}

function isExactDuplicate(candidate: any, incoming: UpsertRow): boolean {
  // Consultor — se ambos os lados o têm, tem de ser o mesmo. Se um lado
  // não o tem, não bloqueia (evita perder o auto-merge por falta de dados).
  const cCons = normText(candidate?.consultor_nome);
  const iCons = normText(incoming.consultor_nome);
  if (cCons && iCons && cCons !== iCons) return false;
  const cConsTel = normalizePhone(candidate?.consultor_telefone);
  const iConsTel = normalizePhone(incoming.consultor_telefone);
  if (cConsTel && iConsTel && cConsTel !== iConsTel) return false;
  // Nome do comprador — se ambos preenchidos, iguais.
  const cNome = normText(candidate?.contact_nome);
  const iNome = normText(incoming.contact_nome);
  if (cNome && iNome && cNome !== iNome) return false;
  // Texto original — se ambos preenchidos, iguais.
  const cText = normText(candidate?.texto_original ?? candidate?.resumo);
  const iText = normText(incoming.texto_original ?? incoming.resumo);
  if (cText && iText && cText !== iText) return false;
  // Critérios essenciais têm de bater certo.
  if (criteriaSignature(candidate?.criteria) !== criteriaSignature(incoming.criteria)) return false;
  return true;
}

async function mergeInto(
  supabase: any,
  userId: string,
  existingId: string,
  existing: any,
  row: UpsertRow,
  similarity: number,
  reason: string,
): Promise<UpsertResult> {
  const nextCriteria = mergeCriteria(existing.criteria as Record<string, unknown>, row.criteria);
  // Release 1.2.5 — a fusão NUNCA renova a validade a partir de "agora".
  // Deriva sempre da data de publicação/origem conhecida; sem base,
  // mantém a expiração já gravada (reimportar não estende).
  const mergedExpires =
    expiresFromBase({
      data_publicacao: row.data_publicacao ?? existing.data_publicacao ?? null,
      data_origem: row.data_origem ?? existing.data_origem ?? null,
    }) ??
    existing.expires_at ??
    row.expires_at;
  // Release 1.2.7 — exceção controlada: se esta fusão vem de um FICHEIRO/LOTE
  // novo (batch_key inédito), reaparecer significa que o comprador continua
  // ativo → data_publicacao passa a hoje e a validade recalcula a partir daí.
  const renewal = shouldRenewOnMerge({
    origem: row.origem,
    batchKey: row.batch_key ?? null,
    batchRenewable: row.batch_renewable ?? false,
    existingRenewedByBatchKey: existing.renewed_by_batch_key ?? null,
  });
  const patch = renewal.renew ? renewalPatch(String(row.batch_key)) : null;
  const update: Record<string, unknown> = {
    criteria: nextCriteria,
    expires_at: patch ? patch.expires_at : mergedExpires,
    origem: row.origem,
    import_batch_id: row.import_batch_id,
    resumo: row.resumo ?? existing.resumo,
    texto_original: row.texto_original ?? existing.texto_original,
    contact_nome: row.contact_nome ?? existing.contact_nome,
    contact_email: row.contact_email ?? existing.contact_email,
    contact_grupo: row.contact_grupo ?? existing.contact_grupo,
    data_publicacao: patch ? patch.data_publicacao : (row.data_publicacao ?? existing.data_publicacao),
    similarity_score: similarity,
    decision_reason: (patch ? `${reason} | renovada (lote novo)` : reason).slice(0, 900),
    merged_from_count: (existing.merged_from_count ?? 0) + 1,
    consultor_nome: row.consultor_nome ?? existing.consultor_nome,
    consultor_telefone: row.consultor_telefone ?? existing.consultor_telefone,
    data_origem: row.data_origem ?? existing.data_origem,
    hora_origem: row.hora_origem ?? existing.hora_origem,
    grupo_whatsapp: row.grupo_whatsapp ?? existing.grupo_whatsapp,
    comunidade: row.comunidade ?? existing.comunidade,
  };
  if (patch) {
    update.renewed_by_batch_key = patch.renewed_by_batch_key;
    update.renewed_at = patch.renewed_at;
  }
  // Fase 3 — se o caller resolveu location_ids, propaga para o registo
  // fundido; nunca sobrescreve com [] quando o caller não os resolveu.
  if (row.location_ids && row.location_ids.length > 0) {
    (update as any).location_ids = row.location_ids;
  }
  const { data: upd, error } = await supabase
    .from("active_searches")
    .update(update)
    .eq("id", existingId)
    .eq("user_id", userId)
    .select("id, expires_at, flagged_for_review")
    .single();
  if (error) throw new Error(error.message);
  return {
    id: upd.id,
    expires_at: upd.expires_at,
    action: "updated",
    similarity,
    flagged_for_review: !!upd.flagged_for_review,
    reason,
    renewed: !!patch,
  };
}

async function insertNew(
  supabase: any,
  userId: string,
  row: UpsertRow,
  similarity: number,
  reason: string,
  action: Exclude<UpsertAction, "updated">,
): Promise<UpsertResult> {
  const { data: ins, error } = await supabase
    .from("active_searches")
    .insert({
      user_id: userId,
      dedup_key: row.dedup_key,
      criteria: row.criteria,
      resumo: row.resumo,
      texto_original: row.texto_original,
      contact_nome: row.contact_nome,
      contact_telefone: row.contact_telefone,
      contact_email: row.contact_email,
      contact_grupo: row.contact_grupo,
      data_publicacao: row.data_publicacao,
      expires_at: row.expires_at,
      origem: row.origem,
      import_batch_id: row.import_batch_id,
      similarity_score: similarity,
      decision_reason: reason.slice(0, 900),
      flagged_for_review: action === "flagged",
      consultor_nome: row.consultor_nome ?? null,
      consultor_telefone: row.consultor_telefone ?? null,
      data_origem: row.data_origem ?? null,
      hora_origem: row.hora_origem ?? null,
      grupo_whatsapp: row.grupo_whatsapp ?? null,
      comunidade: row.comunidade ?? null,
      location_ids: row.location_ids ?? [],
    })
    .select("id, expires_at")
    .single();
  if (error) throw new Error(error.message);
  return {
    id: ins.id,
    expires_at: ins.expires_at,
    action,
    similarity,
    flagged_for_review: action === "flagged",
    reason,
  };
}

export async function upsertOne(
  supabase: any,
  userId: string,
  row: UpsertRow,
): Promise<UpsertResult> {
  // Correções 1.3: garantir formato único (normalização defensiva também
  // aqui — permite a callers que ainda não normalizaram).
  row = {
    ...row,
    contact_telefone: normalizePhone(row.contact_telefone) ?? null,
    consultor_telefone: normalizePhone(row.consultor_telefone) ?? null,
  };
  const incomingCriteria = row.criteria as SimilarityCriteria;
  const incomingText = row.texto_original ?? row.resumo ?? null;

  // 1) Candidate lookup.
  //
  // Contactos persistentes + dedup reforçada:
  //  - o telefone efetivo é `contact_telefone` OU `consultor_telefone` (o
  //    número da mesma pessoa aparece indistintamente numa das colunas,
  //    dependendo do canal/ficheiro de origem);
  //  - quando não existe telefone nenhum, deixamos de desistir: procuramos
  //    candidatos pelo NOME normalizado. O nome sozinho NUNCA funde — serve
  //    apenas para encontrar candidatos, e o caminho "só nome" exige prova
  //    adicional (texto idêntico ou score >= 95) antes de fundir.
  const SELECT_COLS =
    "id, criteria, contact_nome, contact_email, contact_grupo, contact_telefone, texto_original, resumo, data_publicacao, data_origem, hora_origem, expires_at, merged_from_count, consultor_nome, consultor_telefone, flagged_for_review, renewed_by_batch_key";
  const phone = effectivePhone(row);
  const incomingName = normContactName(row.contact_nome ?? row.consultor_nome);

  // Aprendizagem de contacto: se esta linha traz nome + telefone, guardamos o
  // par para que importações futuras da mesma pessoa (sem número no ficheiro)
  // fiquem automaticamente preenchidas.
  if (phone && incomingName) {
    await saveContact(supabase, {
      nome: row.contact_nome ?? row.consultor_nome,
      telefone: phone,
      email: row.contact_email ?? null,
      origem: "import",
    });
  }

  let candidates: any[] = [];
  let matchedBy: "telefone" | "nome" = "telefone";

  if (phone) {
    const { data: rawCandidates } = await supabase
      .from("active_searches")
      .select(SELECT_COLS)
      .eq("user_id", userId)
      .or(`contact_telefone.ilike.%${phone}%,consultor_telefone.ilike.%${phone}%`)
      .limit(200);
    candidates = (rawCandidates ?? []).filter((c: any) => effectivePhoneOf(c) === phone);
  } else if (incomingName) {
    matchedBy = "nome";
    const like = (row.contact_nome ?? row.consultor_nome ?? "").trim();
    const { data: rawCandidates } = await supabase
      .from("active_searches")
      .select(SELECT_COLS)
      .eq("user_id", userId)
      .or(`contact_nome.ilike.%${like}%,consultor_nome.ilike.%${like}%`)
      .limit(200);
    candidates = (rawCandidates ?? []).filter(
      (c: any) =>
        normContactName(c.contact_nome ?? c.consultor_nome) === incomingName &&
        !effectivePhoneOf(c),
    );
  }

  if (candidates.length === 0) {
    return await insertNew(
      supabase,
      userId,
      row,
      0,
      phone ? "sem candidato compatível" : "sem telefone nem contacto conhecido — criada como nova",
      "created",
    );
  }

  // Correção do bug das "primárias paralelas": quando o telefone efetivo e o
  // texto original coincidem exatamente, é o MESMO pedido — mesmo que a
  // assinatura de critérios divirja (o splitter é não-determinístico e produz
  // variações para o mesmo texto). Antes, essa divergência fazia nascer duas
  // linhas primárias, cada uma a absorver as suas cópias.
  if (phone && normalizeTextKey(incomingText)) {
    const sameText = candidates.find(
      (c: any) =>
        normalizeTextKey(c.texto_original ?? c.resumo) === normalizeTextKey(incomingText),
    );
    if (sameText) {
      return await mergeInto(
        supabase,
        userId,
        sameText.id,
        sameText,
        row,
        100,
        "mesmo telefone e mesmo texto original (auto-merge) — critérios fundidos",
      );
    }
  }

  // Curto-circuito determinístico — duplicado exato.
  // Correções Pós-1.3 Melhoria 4: quando o registo é verdadeiramente idêntico
  // (mesmo consultor, mesmo telefone, mesmo nome, mesmo texto, mesmos
  // critérios essenciais), fundir silenciosamente. Nunca enviar para Revisão.
  const exact = candidates.find((c: any) => isExactDuplicate(c, row));
  if (exact) {
    console.info(
      `[dedup] auto-merge exact duplicate: existing=${exact.id} user=${userId} phone=${phone}`,
    );
    const res = await mergeInto(
      supabase,
      userId,
      exact.id,
      exact,
      row,
      100,
      "duplicado exato (auto-merge)",
    );
    // Limpar qualquer flag antiga de revisão neste registo.
    if ((exact as any).flagged_for_review) {
      await supabase
        .from("active_searches")
        .update({ flagged_for_review: false })
        .eq("id", exact.id);
      res.flagged_for_review = false;
    }
    return res;
  }

  // 2) Score determinístico contra cada candidato — escolhe o melhor.
  let best: any = null;
  let bestScore = 0;
  let bestReasons: string[] = [];
  for (const c of candidates) {
    const r = scoreSimilarity(
      (c.criteria ?? {}) as SimilarityCriteria,
      incomingCriteria,
      { textA: c.texto_original ?? c.resumo, textB: incomingText },
    );
    if (r.score > bestScore) {
      bestScore = r.score;
      best = c;
      bestReasons = r.reasons;
    }
  }

  const reasonSummary = bestReasons.join("; ").slice(0, 700);

  // Caminho "só nome" (sem telefone em nenhum dos lados): exige prova
  // adicional antes de fundir, para que nomes comuns não colapsem pessoas
  // diferentes. Texto praticamente idêntico OU score >= 95 funde; a zona
  // cinzenta 80-94 vai para Revisão; abaixo de 80 é procura nova.
  if (matchedBy === "nome") {
    const jac = textJaccard(best?.texto_original ?? best?.resumo, incomingText);
    if (jac >= 0.95 || bestScore >= 95) {
      return await mergeInto(
        supabase,
        userId,
        best.id,
        best,
        row,
        Math.max(bestScore, Math.round(jac * 100)),
        `mesma pessoa por nome, sem telefone — evidência forte (texto j=${jac.toFixed(2)}, score ${bestScore}%): ${reasonSummary}`,
      );
    }
    if (bestScore >= 80) {
      return await insertNew(
        supabase,
        userId,
        row,
        bestScore,
        `nome coincide sem telefone e evidência insuficiente (${bestScore}%, texto j=${jac.toFixed(2)}) — rever manualmente: ${reasonSummary}`,
        "flagged",
      );
    }
    return await insertNew(
      supabase,
      userId,
      row,
      bestScore,
      `nome coincide mas necessidade distinta (${bestScore}%): ${reasonSummary}`,
      "created",
    );
  }

  // 3) Regras de negócio + IA
  //
  // Correção deduplicação (Sprint WhatsApp re-importação):
  // Quando o score determinístico é ≥95, o candidato é praticamente idêntico
  // — a divergência residual deve-se tipicamente a variações não-determinísticas
  // do LLM em `splitBuyerSearches`, enriquecimentos posteriores da criteria,
  // ou fusões anteriores que acumularam campos extras no registo existente.
  // Nestes casos o comportamento correto é FUNDIR no registo existente
  // (atualizando informação nova) e sinalizar para revisão para manter
  // visibilidade administrativa. Criar um NOVO registo flagged, como fazia
  // antes, produzia duplicados a cada nova importação da mesma mensagem —
  // exatamente o bug reportado.
  if (bestScore >= 95) {
    const res = await mergeInto(
      supabase,
      userId,
      best.id,
      best,
      row,
      bestScore,
      `duplicado quase-exato (${bestScore}%) — fundido: ${reasonSummary}`,
    );
    return res;
  }

  // Arbitragem por IA — **último recurso**. Só é chamada quando as regras
  // determinísticas não conseguem decidir. Aplica-se:
  //  1) short-circuits determinísticos de "claramente diferente" (abaixo);
  //  2) score < 85 → claramente distinto, não chama IA;
  //  3) score ≥ 95 → coberto acima (flag sem IA);
  //  4) só o intervalo 85..94, sem conflitos duros, vai para a IA.
  if (bestScore >= 85) {
    // Short-circuit: finalidades conhecidas e divergentes ⇒ necessidades
    // diferentes; não faz sentido pedir arbitragem.
    const finA = (best.criteria as any)?.finalidade;
    const finB = (row.criteria as any)?.finalidade;
    const finKnownA = finA && finA !== "indefinido";
    const finKnownB = finB && finB !== "indefinido";
    if (finKnownA && finKnownB && finA !== finB) {
      return await insertNew(
        supabase,
        userId,
        row,
        bestScore,
        `necessidade distinta (finalidade divergente ${finA} vs ${finB}) — sem arbitragem`,
        "created",
      );
    }
    // Short-circuit: tipologias conhecidas e diferentes ⇒ procuras distintas.
    const tipA = (best.criteria as any)?.tipologia;
    const tipB = (row.criteria as any)?.tipologia;
    if (
      tipA &&
      tipB &&
      String(tipA).toUpperCase().trim() !== String(tipB).toUpperCase().trim()
    ) {
      return await insertNew(
        supabase,
        userId,
        row,
        bestScore,
        `necessidade distinta (tipologia divergente ${tipA} vs ${tipB}) — sem arbitragem`,
        "created",
      );
    }
    const { aiArbitrateDedup } = await import("./dedup-ai.server");
    const ai = await aiArbitrateDedup({
      incoming: {
        criteria: row.criteria,
        texto: incomingText,
        nome: row.contact_nome,
      },
      candidate: {
        criteria: (best.criteria ?? {}) as Record<string, unknown>,
        texto: best.texto_original ?? best.resumo ?? null,
        nome: best.contact_nome,
      },
      ruleScore: bestScore,
    });
    // A decisão "update" da IA passou também a sinalizar para revisão:
    // qualquer alteração relevante fica visível ao administrador antes
    // de sobrescrever silenciosamente o registo existente.
    if (ai.decision === "update" || ai.decision === "review") {
      return await insertNew(
        supabase,
        userId,
        row,
        bestScore,
        `${ai.decision === "update" ? "IA sugere fundir" : "IA em dúvida"} (${bestScore}%): ${ai.reason} | ${reasonSummary}`,
        "flagged",
      );
    }
    return await insertNew(
      supabase,
      userId,
      row,
      bestScore,
      `IA separar (${bestScore}%): ${ai.reason} | ${reasonSummary}`,
      "kept_separate",
    );
  }

  return await insertNew(
    supabase,
    userId,
    row,
    bestScore,
    `necessidade distinta (${bestScore}%): ${reasonSummary}`,
    "created",
  );
}

async function purgeExpired(supabase: any, userId: string) {
  await supabase.from("active_searches").delete().eq("user_id", userId).lt("expires_at", new Date().toISOString());
}

export const listActiveSearches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminContext(context);
    const { supabase, userId } = context;
    await purgeExpired(supabase, userId);
    const { data, error } = await supabase
      .from("active_searches")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { searches: data ?? [] };
  });

export const deleteActiveSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminContext(context);
    const { supabase, userId } = context;
    const { error } = await supabase.from("active_searches").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function criteriaToBuyer(c: ActiveSearchCriteria, location_ids: string[] = []): BuyerLike {
  const finalidade = c.finalidade === "indefinido" ? undefined : c.finalidade;
  const gar = (c.caracteristicas ?? []).some((x) => /garagem/i.test(x));
  const ele = (c.caracteristicas ?? []).some((x) => /elevador/i.test(x));
  return {
    finalidade,
    tipo_imovel: c.tipo_imovel ?? null,
    tipologia: c.tipologia ?? null,
    categorias: (c as any).categorias ?? null,
    categoria_origem: (c as any).categoria_origem ?? null,
    location_ids,
    budget_min: c.budget_min ?? null,
    budget_max: c.budget_max ?? null,
    area_min: c.area_min ?? null,
    quartos_min: c.quartos_min ?? null,
    garagem_obrigatoria: gar,
    elevador_obrigatorio: ele,
    proximity: c.proximity ?? null,
    caracteristicas: c.caracteristicas ?? null,
  };
}

export type ActiveSearchMatch = {
  search_id: string;
  contact_nome: string | null;
  contact_telefone: string | null;
  contact_grupo: string | null;
  data_publicacao: string | null;
  created_at: string;
  resumo: string | null;
  score: number;
  reasons: string[];
};

export const matchPropertyAgainstActiveSearches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ propertyId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await purgeExpired(supabase, userId);

    const { data: prop, error: pErr } = await supabase
      .from("properties")
      .select(
        "id, referencia, tipo_imovel, tipologia, distrito, concelho, freguesia, zona, preco, area_util_m2, area_m2, area_terreno_m2, quartos, garagem, elevador, jardim, piscina, finalidade, location_id",
      )
      .eq("id", data.propertyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prop) return { property: null, matches: [] as ActiveSearchMatch[] };

    const { data: searches, error: sErr } = await supabase
      .from("active_searches")
      .select("*")
      .eq("user_id", userId);
    if (sErr) throw new Error(sErr.message);

    const matches: ActiveSearchMatch[] = [];
    const persist: Array<{ search_id: string; score: number; reasons: string[]; categories: any }> = [];
    const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());
    for (const s of searches ?? []) {
      const buyer = criteriaToBuyer(s.criteria as ActiveSearchCriteria, (s as any).location_ids ?? []);
      const res = scoreMatch(buyer, prop, { geoIndex });
      if (res.compatible && res.score >= 60) {
        matches.push({
          search_id: s.id,
          contact_nome: s.contact_nome,
          contact_telefone: s.contact_telefone,
          contact_grupo: s.contact_grupo,
          data_publicacao: s.data_publicacao,
          created_at: s.created_at,
          resumo: s.resumo,
          score: res.score,
          reasons: res.reasons,
        });
        persist.push({ search_id: s.id, score: res.score, reasons: res.reasons, categories: res.categories });
      }
    }
    matches.sort((a, b) => b.score - a.score);

    // Persistir oportunidades (idempotente por (property_id, active_search_id)).
    if (persist.length > 0) {
      // Buscar existentes para decidir insert vs update sem duplicar.
      const { data: existing } = await supabase
        .from("match_opportunities")
        .select("id, active_search_id, score")
        .eq("user_id", userId)
        .eq("property_id", prop.id);
      const existingMap = new Map<string, { id: string; score: number }>(
        (existing ?? []).map((e: any) => [e.active_search_id, { id: e.id, score: e.score }]),
      );
      for (const m of persist) {
        const prev = existingMap.get(m.search_id);
        if (!prev) {
          await supabase.from("match_opportunities").insert({
            user_id: userId,
            property_id: prop.id,
            active_search_id: m.search_id,
            score: m.score,
            reasons: m.reasons,
            categories: m.categories,
          });
        } else if (prev.score !== m.score) {
          // Alteração relevante — mantém id, reabre para revisão.
          await supabase
            .from("match_opportunities")
            .update({ score: m.score, reasons: m.reasons, categories: m.categories, viewed_at: null })
            .eq("id", prev.id);
        }
      }
    }

    return { property: { id: prop.id, referencia: prop.referencia }, matches };
  });

// Lista oportunidades por visualizar + recentes, para o Radar.
export const listOpportunities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminContext(context);
    const { supabase, userId } = context;
    await purgeExpired(supabase, userId);
    const { data, error } = await supabase
      .from("match_opportunities")
      .select(
        "id, score, reasons, viewed_at, created_at, updated_at, property_id, active_search_id, properties(id, referencia, tipo_imovel, tipologia, zona, freguesia, concelho, preco, finalidade, location_id), active_searches(id, contact_nome, contact_telefone, contact_grupo, resumo, texto_original, origem, criteria, location_ids)",
      )
      .eq("user_id", userId)
      .order("viewed_at", { ascending: true, nullsFirst: true })
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    // Release 1.2.1 — REVALIDAÇÃO OBRIGATÓRIA em tempo real. Nunca confiamos
    // no que está persistido: cada oportunidade é re-executada nos Hard
    // Filters actuais. Se deixar de passar, apagamos a linha e não devolvemos.
    const rows = data ?? [];
    const staleIds: string[] = [];
    const valid: typeof rows = [];
    const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());
    for (const row of rows) {
      const p = (row as any).properties;
      const s = (row as any).active_searches;
      if (!p || !s) {
        staleIds.push(row.id);
        continue;
      }
      const buyer = criteriaToBuyer(s.criteria as ActiveSearchCriteria, (s as any).location_ids ?? []);
      // Aumentar com dados de área/preço vindos do imóvel completo
      const { data: fullProp } = await supabase
        .from("properties")
        .select("area_util_m2, area_m2, area_terreno_m2, quartos, garagem, elevador, jardim, piscina")
        .eq("id", p.id)
        .maybeSingle();
      const propFull = { ...p, ...(fullProp ?? {}) };
      const res = scoreMatch(buyer, propFull, { geoIndex });
      if (!res.compatible || res.score < 60) {
        staleIds.push(row.id);
        continue;
      }
      valid.push({ ...row, score: res.score, reasons: res.reasons } as any);
    }
    if (staleIds.length > 0) {
      // Fire-and-forget cleanup — não bloqueia a resposta.
      void supabase.from("match_opportunities").delete().in("id", staleIds).eq("user_id", userId);
    }
    return { opportunities: valid };
  });

// Contagem de oportunidades por visualizar (para o badge do menu).
export const countUnseenOpportunities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Radar é exclusivo de Admin: consultores recebem 0 sem erro.
    if (!(await isAdminContext(context))) return { unseen: 0 };
    const { supabase, userId } = context;
    const { count, error } = await supabase
      .from("match_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("viewed_at", null);
    if (error) throw new Error(error.message);
    return { unseen: count ?? 0 };
  });

// Marca todas as oportunidades por visualizar como vistas.
export const markOpportunitiesViewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminContext(context);
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("match_opportunities")
      .update({ viewed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("viewed_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Recalcula oportunidades para uma Procura Ativa recém-criada/atualizada,
// contra todos os imóveis ativos do utilizador.
export const recomputeOpportunitiesForSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ searchId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: s } = await supabase
      .from("active_searches")
      .select("id, criteria, location_ids")
      .eq("id", data.searchId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!s) return { created: 0 };

    const { data: props } = await supabase
      .from("properties")
      .select(
        "id, tipo_imovel, tipologia, distrito, concelho, freguesia, zona, preco, area_util_m2, area_m2, area_terreno_m2, quartos, garagem, elevador, jardim, piscina, finalidade, location_id",
      )
      .eq("user_id", userId)
      .eq("ativo", true);

    const buyer = criteriaToBuyer(s.criteria as ActiveSearchCriteria, (s as any).location_ids ?? []);
    const { data: existing } = await supabase
      .from("match_opportunities")
      .select("id, property_id, score")
      .eq("user_id", userId)
      .eq("active_search_id", s.id);
    const existingMap = new Map<string, { id: string; score: number }>(
      (existing ?? []).map((e: any) => [e.property_id, { id: e.id, score: e.score }]),
    );

    let created = 0;
    const geoIndex = buildGeoMatchIndex(await LocationRepository.getSnapshot());
    for (const p of props ?? []) {
      const r = scoreMatch(buyer, p, { geoIndex });
      if (!r.compatible || r.score < 60) continue;
      const prev = existingMap.get(p.id);
      if (!prev) {
        await supabase.from("match_opportunities").insert({
          user_id: userId,
          property_id: p.id,
          active_search_id: s.id,
          score: r.score,
          reasons: r.reasons,
          categories: r.categories,
        });
        created++;
      } else if (prev.score !== r.score) {
        await supabase
          .from("match_opportunities")
          .update({ score: r.score, reasons: r.reasons, categories: r.categories, viewed_at: null })
          .eq("id", prev.id);
      }
    }
    return { created };
  });