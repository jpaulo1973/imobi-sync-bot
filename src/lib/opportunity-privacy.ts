// Release 1.2 — Privacy Layer.
//
// Todas as server functions que devolvam buyers, active_searches ou
// properties DEVEM devolver o resultado destes sanitizadores. Nunca linhas
// brutas da base. O viewerId determina se é dono (mostra tudo) ou terceiro
// (mostra apenas critérios/ficha pública + contactos do consultor).

export type BuyerDTO = {
  id: string;
  isOwner: boolean;
  // Só quando isOwner === true
  nome: string | null;
  telefone: string | null;
  email: string | null;
  notas: string | null;
  // Sempre visível (critérios de procura)
  finalidade: string | null;
  tipologia: string | null;
  zona: string | null;
  tipo_imovel: string[] | null;
  budget_min: number | null;
  budget_max: number | null;
  area_min: number | null;
  quartos_min: number | null;
  garagem_obrigatoria: boolean | null;
  elevador_obrigatorio: boolean | null;
  proximity: unknown | null;
  created_at: string | null;
  // Contactos do consultor do buyer (nunca do próprio buyer para terceiros)
  consultor_nome: string | null;
  consultor_email: string | null;
  consultor_telefone: string | null;
  consultor_agency: string | null;
};

export type SearchDTO = {
  id: string;
  isOwner: boolean;
  origem: string | null;
  score?: number;
  reasons?: string[];
  // Só quando isOwner === true
  nome: string | null;
  telefone: string | null;
  email: string | null;
  // Sempre visível
  finalidade: string | null;
  tipologia: string | null;
  zona: string | null;
  tipo_imovel: string[] | null;
  budget_min: number | null;
  budget_max: number | null;
  area_min: number | null;
  proximity: unknown | null;
  resumo: string | null;
  comunidade: string | null;
  grupo_whatsapp: string | null;
  data_origem: string | null;
  created_at: string | null;
  // Contactos do consultor
  consultor_nome: string | null;
  consultor_email: string | null;
  consultor_telefone: string | null;
  consultor_agency: string | null;
};

export type PropertyDTO = {
  id: string;
  isOwner: boolean;
  referencia: string | null;
  finalidade: string | null;
  tipo_imovel: string | null;
  tipologia: string | null;
  distrito: string | null;
  concelho: string | null;
  freguesia: string | null;
  zona: string | null;
  preco: number | null;
  area_util_m2: number | null;
  area_m2: number | null;
  quartos: number | null;
  garagem: boolean | null;
  elevador: boolean | null;
  jardim: boolean | null;
  piscina: boolean | null;
  descricao: string | null;
  caracteristicas: string | null;
  ativo: boolean | null;
  created_at: string | null;
  // Contactos do consultor angariador
  consultor_nome: string | null;
  consultor_email: string | null;
  consultor_telefone: string | null;
  consultor_agency: string | null;
};

/**
 * Meta do consultor dono do registo. As chamadas devem pré-carregar isto
 * (via profiles + auth.users) e passar no sanitizador.
 */
export type ConsultorMeta = {
  nome: string | null;
  email: string | null;
  telefone: string | null;
  agency: string | null;
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function sanitizeBuyerForViewer(
  buyer: any,
  viewerId: string,
  consultor: ConsultorMeta | null = null,
): BuyerDTO {
  const isOwner = buyer?.user_id === viewerId;
  return {
    id: buyer.id,
    isOwner,
    nome: isOwner ? buyer.nome ?? null : null,
    telefone: isOwner ? buyer.telefone ?? null : null,
    email: isOwner ? buyer.email ?? null : null,
    notas: isOwner ? buyer.notas ?? null : null,
    finalidade: buyer.finalidade ?? null,
    tipologia: buyer.tipologia ?? null,
    zona: buyer.zona ?? null,
    tipo_imovel: buyer.tipo_imovel ?? null,
    budget_min: num(buyer.budget_min),
    budget_max: num(buyer.budget_max),
    area_min: num(buyer.area_min),
    quartos_min: buyer.quartos_min ?? null,
    garagem_obrigatoria: buyer.garagem_obrigatoria ?? null,
    elevador_obrigatorio: buyer.elevador_obrigatorio ?? null,
    proximity: buyer.proximity ?? null,
    created_at: buyer.created_at ?? null,
    consultor_nome: consultor?.nome ?? null,
    consultor_email: consultor?.email ?? null,
    consultor_telefone: consultor?.telefone ?? null,
    consultor_agency: consultor?.agency ?? null,
  };
}

export function sanitizeSearchForViewer(
  search: any,
  viewerId: string,
  consultor: ConsultorMeta | null = null,
): SearchDTO {
  const isOwner = search?.user_id === viewerId;
  const c = (search.criteria ?? {}) as Record<string, any>;
  return {
    id: search.id,
    isOwner,
    origem: search.origem ?? null,
    nome: isOwner ? search.contact_nome ?? c.nome ?? null : null,
    telefone: isOwner ? search.contact_telefone ?? null : null,
    email: isOwner ? search.contact_email ?? null : null,
    finalidade: c.finalidade ?? null,
    tipologia: c.tipologia ?? null,
    zona: c.zona ?? c.municipio ?? c.freguesia ?? null,
    tipo_imovel: c.tipo_imovel ?? null,
    budget_min: num(c.budget_min),
    budget_max: num(c.budget_max),
    area_min: num(c.area_min),
    proximity: search.proximity ?? null,
    resumo: search.resumo ?? null,
    comunidade: search.comunidade ?? null,
    grupo_whatsapp: search.grupo_whatsapp ?? search.contact_grupo ?? null,
    data_origem: search.data_origem ?? null,
    created_at: search.created_at ?? null,
    // Release 1.3 — fonte única do consultor é loadConsultorMeta; o campo
    // legado search.consultor_nome ficava "colado" a valores importados
    // antigos e apresentava sempre o mesmo utilizador. Já não é usado.
    consultor_nome: consultor?.nome ?? null,
    consultor_email: consultor?.email ?? null,
    consultor_telefone: consultor?.telefone ?? null,
    consultor_agency: consultor?.agency ?? null,
  };
}

export function sanitizePropertyForViewer(
  property: any,
  viewerId: string,
  consultor: ConsultorMeta | null = null,
): PropertyDTO {
  const isOwner = property?.user_id === viewerId;
  return {
    id: property.id,
    isOwner,
    referencia: property.referencia ?? null,
    finalidade: property.finalidade ?? null,
    tipo_imovel: property.tipo_imovel ?? null,
    tipologia: property.tipologia ?? null,
    distrito: property.distrito ?? null,
    concelho: property.concelho ?? null,
    freguesia: property.freguesia ?? null,
    zona: property.zona ?? null,
    preco: num(property.preco),
    area_util_m2: num(property.area_util_m2),
    area_m2: num(property.area_m2),
    quartos: property.quartos ?? null,
    garagem: property.garagem ?? null,
    elevador: property.elevador ?? null,
    jardim: property.jardim ?? null,
    piscina: property.piscina ?? null,
    descricao: property.descricao ?? null,
    caracteristicas: property.caracteristicas ?? null,
    ativo: property.ativo ?? null,
    created_at: property.created_at ?? null,
    consultor_nome: consultor?.nome ?? null,
    consultor_email: consultor?.email ?? null,
    consultor_telefone: consultor?.telefone ?? null,
    consultor_agency: consultor?.agency ?? null,
  };
}

/**
 * Pré-carrega meta de consultores (nome/email/telefone) para uma lista de
 * userIds. Usa admin (profiles + auth.users). Devolve um Map userId → meta.
 */
export async function loadConsultorMeta(userIds: string[]): Promise<Map<string, ConsultorMeta>> {
  const map = new Map<string, ConsultorMeta>();
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return map;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, agency")
      .in("id", unique);
    for (const p of profs ?? []) {
      map.set(p.id, {
        nome: p.full_name ?? null,
        email: null,
        telefone: null,
        agency: (p as any).agency ?? null,
      });
    }
    // Emails vêm de auth.users via admin. Uma chamada por user — barato
    // para os poucos consultores que aparecem no set.
    for (const uid of unique) {
      try {
        const { data } = await supabaseAdmin.auth.admin.getUserById(uid);
        const email = data?.user?.email ?? null;
        const phone = (data?.user?.phone as string | undefined) ?? null;
        const cur = map.get(uid) ?? {
          nome: null,
          email: null,
          telefone: null,
          agency: null,
        };
        map.set(uid, { ...cur, email, telefone: phone });
      } catch {
        // ignore
      }
    }
  } catch (e) {
    console.error("loadConsultorMeta failed", e);
  }
  return map;
}