import { describe, it, expect } from "vitest";
import { planBulkLine, type BulkSearchRow } from "./review-bulk";

const row = (over: Partial<BulkSearchRow> = {}): BulkSearchRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  contact_nome: "Sofia Vaz C21N",
  consultor_nome: null,
  contact_telefone: null,
  consultor_telefone: null,
  criteria: { finalidade: "venda", tipologia: "T2", zona: "Almada" },
  ...over,
});

describe("planBulkLine", () => {
  it("nome_novo sozinho atualiza contact_nome e dedup_key sem tocar no telefone", () => {
    const p = planBulkLine({ linha: 2, search_ids: ["x"], nome_novo: "Sofia Vaz" }, [row()]);
    expect(p.error).toBeUndefined();
    expect(p.nome_aplicado).toBe(true);
    expect(p.patches).toHaveLength(1);
    expect(p.patches[0]!.patch.contact_nome).toBe("Sofia Vaz");
    expect(typeof p.patches[0]!.patch.dedup_key).toBe("string");
    expect(p.patches[0]!.patch).not.toHaveProperty("consultor_telefone");
    expect(p.learn).toHaveLength(0);
  });

  it("telefone_novo sozinho mantém o comportamento atual (nome inalterado)", () => {
    const p = planBulkLine({ linha: 2, search_ids: ["x"], telefone: "920505485" }, [row()]);
    expect(p.nome_aplicado).toBe(false);
    expect(p.patches[0]!.patch).toEqual({
      consultor_telefone: "920505485",
      flagged_for_review: false,
    });
    expect(p.learn).toEqual([{ nome: "Sofia Vaz C21N", telefone: "920505485" }]);
  });

  it("nome_novo + telefone_novo: aprendizagem usa o nome novo", () => {
    const p = planBulkLine(
      { linha: 3, search_ids: ["x"], telefone: "+351 920 505 485", nome_novo: "Sofia Vaz" },
      [row()],
    );
    expect(p.patches[0]!.patch.contact_nome).toBe("Sofia Vaz");
    expect(p.patches[0]!.patch.consultor_telefone).toBe("+351 920 505 485");
    expect(p.learn).toEqual([{ nome: "Sofia Vaz", telefone: "920505485" }]);
    expect(p.learn.some((l) => l.nome.includes("C21N"))).toBe(false);
  });

  it("nome_novo igual ao atual (acentos/caixa) não gera alteração de nome", () => {
    const p = planBulkLine({ linha: 4, search_ids: ["x"], nome_novo: "sofia váz c21n" }, [row()]);
    expect(p.error).toBeUndefined();
    expect(p.nome_aplicado).toBe(false);
    expect(p.patches).toHaveLength(0);
  });

  it("dedup_key usa o telefone novo quando fornecido", () => {
    const semTel = planBulkLine({ linha: 5, search_ids: ["x"], nome_novo: "Sofia Vaz" }, [row()]);
    const comTel = planBulkLine(
      { linha: 5, search_ids: ["x"], nome_novo: "Sofia Vaz", telefone: "920505485" },
      [row()],
    );
    expect(semTel.patches[0]!.patch.dedup_key).toMatch(/^k:/);
    expect(comTel.patches[0]!.patch.dedup_key).toBe("p:920505485:venda");
  });

  it("rejeita telefone curto, nome vazio de conteúdo e linha sem procuras válidas", () => {
    expect(planBulkLine({ linha: 6, search_ids: ["x"], telefone: "12345" }, [row()]).error).toMatch(
      /telefone/i,
    );
    expect(planBulkLine({ linha: 7, search_ids: ["x"], nome_novo: "-" }, [row()]).error).toMatch(
      /nome_novo/,
    );
    expect(
      planBulkLine({ linha: 8, search_ids: [], telefone: "920505485" }, []).error,
    ).toMatch(/Nenhuma procura/);
  });
});
