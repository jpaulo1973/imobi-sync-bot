// Release 1.2.14 — regressões do editor lateral de procura na Revisão.
import { describe, expect, it } from "vitest";
import {
  buildUpdatePayload,
  toFormState,
} from "@/components/review/SearchEditSheet";
import type { ReviewSearchDetail } from "@/lib/review.functions";

const detail: ReviewSearchDetail = {
  id: "00000000-0000-0000-0000-000000000001",
  user_id: "u1",
  origem: "excel",
  created_at: new Date().toISOString(),
  resumo: "Armazém ou habitacional em Loures",
  texto_original: "Imóvel urbano, industrial ou habitacional",
  contact_nome: "Luísa Tinoco",
  contact_telefone: "912345678",
  consultor_nome: null,
  grupo_whatsapp: null,
  location_ids: ["11111111-1111-1111-1111-111111111111"],
  flagged_for_review: false,
  criteria: {
    finalidade: "venda",
    tipologia: null,
    tipo_imovel: ["Armazém"],
    budget_min: null,
    budget_max: 500000,
    area_min: 7000,
    quartos_min: null,
    categorias: [],
    categoria_origem: "indecidivel",
    motivo_indecidivel: "multi_uso",
  },
};

describe("editor de procura — diff de critérios", () => {
  it("não envia nada quando nada é tocado", () => {
    const initial = toFormState(detail);
    const payload = buildUpdatePayload(initial, initial);
    expect(payload).toEqual({ criteria: {} });
  });

  it("limpar área mínima envia null (e não apaga o resto)", () => {
    const initial = toFormState(detail);
    const payload = buildUpdatePayload(initial, { ...initial, area_min: "" });
    expect(payload).toEqual({ criteria: { area_min: null } });
  });

  it("grava categorias escolhidas junto com o ajuste de área", () => {
    const initial = toFormState(detail);
    const payload = buildUpdatePayload(initial, {
      ...initial,
      area_min: "",
      categorias: ["casas_apartamentos", "comercial_armazens"],
    });
    expect(payload).toEqual({
      criteria: {
        area_min: null,
        categorias: ["casas_apartamentos", "comercial_armazens"],
      },
    });
  });

  it("números aceitam vírgula decimal e rejeitam texto", () => {
    const initial = toFormState(detail);
    expect(
      buildUpdatePayload(initial, { ...initial, budget_max: "450000,5" }),
    ).toEqual({ criteria: { budget_max: 450000.5 } });
    expect(() =>
      buildUpdatePayload(initial, { ...initial, budget_max: "muito" }),
    ).toThrow();
  });

  it("tipo_imovel vazio limpa o campo; contactos e localização só quando mudam", () => {
    const initial = toFormState(detail);
    expect(buildUpdatePayload(initial, { ...initial, tipo_imovel: "" })).toEqual({
      criteria: { tipo_imovel: null },
    });
    const p = buildUpdatePayload(initial, {
      ...initial,
      contact_telefone: "961111111",
      location_ids: ["22222222-2222-2222-2222-222222222222"],
    });
    expect(p).toEqual({
      criteria: {},
      contact_telefone: "961111111",
      location_ids: ["22222222-2222-2222-2222-222222222222"],
    });
  });

  it("pré-preenche o formulário com os valores atuais da procura", () => {
    const f = toFormState(detail);
    expect(f.area_min).toBe("7000");
    expect(f.budget_min).toBe("");
    expect(f.tipo_imovel).toBe("Armazém");
    expect(f.categorias).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Release 1.3.2 — tipo de negócio (finalidade) editável no editor lateral.
// ---------------------------------------------------------------------------
describe("editor de procura — tipo de negócio", () => {
  it("alterar a finalidade envia só esse campo", () => {
    const initial = toFormState(detail);
    expect(
      buildUpdatePayload(initial, { ...initial, finalidade: "arrendamento" }),
    ).toEqual({ criteria: { finalidade: "arrendamento" } });
  });

  it("não tocar na finalidade não a envia (protege as procuras 'venda')", () => {
    const initial = toFormState(detail);
    expect(initial.finalidade).toBe("venda");
    expect(buildUpdatePayload(initial, { ...initial, tipologia: "T3" })).toEqual({
      criteria: { tipologia: "T3" },
    });
  });

  it("finalidade ausente/nula no critério mapeia para 'indefinido'", () => {
    const f = toFormState({
      ...detail,
      criteria: { ...detail.criteria, finalidade: null },
    });
    expect(f.finalidade).toBe("indefinido");
  });

  it("finalidade e área alteradas viajam no mesmo patch (um só write)", () => {
    const initial = toFormState(detail);
    expect(
      buildUpdatePayload(initial, {
        ...initial,
        finalidade: "indefinido",
        area_min: "500",
      }),
    ).toEqual({ criteria: { finalidade: "indefinido", area_min: 500 } });
  });
});

