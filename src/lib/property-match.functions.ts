import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const norm = (v: string | null | undefined) =>
  (v ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

export const runPropertyMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ propertyId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: property, error: pErr } = await supabase
      .from("properties")
      .select("*")
      .eq("id", data.propertyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!property) throw new Error("Imóvel não encontrado.");

    const { data: buyers, error: bErr } = await supabase
      .from("buyer_clients")
      .select("*")
      .eq("user_id", userId)
      .eq("ativo", true);
    if (bErr) throw new Error(bErr.message);

    const pFreguesia = norm(property.freguesia);
    const pZona = norm(property.zona);
    const pConcelho = norm(property.concelho);
    const pDistrito = norm(property.distrito);
    const pTipo = norm(property.tipo_imovel);
    const pTipologia = norm(property.tipologia);
    const pArea = Number(property.area_util_m2 ?? property.area_m2 ?? 0);
    const pPreco = Number(property.preco ?? 0);
    const tMatch = /^t(\d+)/i.exec(property.tipologia ?? "");
    const pQuartos = property.quartos ?? (tMatch ? Number(tMatch[1]) : null);

    const ranked = (buyers ?? []).map((b) => {
      let score = 0;
      const reasons: string[] = [];
      let disqualified = false;

      if (b.finalidade && property.finalidade && b.finalidade !== property.finalidade) {
        disqualified = true;
      } else if (b.finalidade === property.finalidade) {
        score += 15;
      }

      if (b.tipo_imovel && b.tipo_imovel.length > 0 && pTipo) {
        const aceites = b.tipo_imovel.map(norm);
        if (aceites.includes(pTipo)) {
          score += 10;
          reasons.push(`Tipo ${property.tipo_imovel}`);
        } else {
          disqualified = true;
        }
      }

      if (b.tipologia && pTipologia) {
        const bt = norm(b.tipologia);
        if (bt === pTipologia || pTipologia.includes(bt) || bt.includes(pTipologia)) {
          score += 15;
          reasons.push(`Tipologia ${property.tipologia}`);
        }
      }

      const bZona = norm(b.zona);
      if (bZona) {
        if (pFreguesia && bZona.includes(pFreguesia)) {
          score += 30; reasons.push(`Freguesia ${property.freguesia}`);
        } else if (pZona && bZona.includes(pZona)) {
          score += 25; reasons.push(`Zona ${property.zona}`);
        } else if (pConcelho && bZona.includes(pConcelho)) {
          score += 18; reasons.push(`Concelho ${property.concelho}`);
        } else if (pDistrito && bZona.includes(pDistrito)) {
          score += 10; reasons.push(`Distrito ${property.distrito}`);
        }
      }

      if (b.budget_max != null && pPreco > 0) {
        if (pPreco <= Number(b.budget_max)) {
          score += 20; reasons.push("Dentro do orçamento");
        } else if (pPreco <= Number(b.budget_max) * 1.1) {
          score += 5; reasons.push("Ligeiramente acima do orçamento");
        } else {
          disqualified = true;
        }
      }
      if (b.budget_min != null && pPreco > 0 && pPreco < Number(b.budget_min) * 0.9) {
        disqualified = true;
      }

      if (b.area_min != null && pArea > 0) {
        if (pArea >= Number(b.area_min)) {
          score += 8; reasons.push(`≥ ${b.area_min} m²`);
        } else {
          disqualified = true;
        }
      }

      if (b.quartos_min != null && pQuartos != null) {
        if (pQuartos >= b.quartos_min) score += 5;
        else disqualified = true;
      }

      if (b.garagem_obrigatoria && property.garagem !== true) disqualified = true;
      if (b.elevador_obrigatorio && property.elevador !== true) disqualified = true;

      return { buyer: b, score, reasons, disqualified };
    });

    const matches = ranked
      .filter((m) => !m.disqualified && m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ buyer, score, reasons }) => ({ buyer, score, reasons }));

    return { matches, totalBuyers: (buyers ?? []).length };
  });
