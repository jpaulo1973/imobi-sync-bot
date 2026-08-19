import { describe, it, expect } from "vitest";
import { parseFilledReviewFile } from "./review-export";

const ID = "11111111-1111-1111-1111-111111111111";
const csv = (body: string, header: string) =>
  new File([header + "\n" + body], "r.csv", { type: "text/csv" });

describe("parseFilledReviewFile — nome_novo", () => {
  it("aceita linha só com nome_novo e reconhece cabeçalhos alternativos", async () => {
    const f = csv(
      `k1,Sofia Vaz C21N,Sofia Vaz,,,${ID}`,
      "id_linha,nome,Novo Nome,telefone_atual,telefone_novo,search_ids",
    );
    const r = await parseFilledReviewFile(f);
    expect(r.prontos).toBe(1);
    expect(r.rows[0]!.nome_novo).toBe("Sofia Vaz");
  });

  it("ignora nome_novo igual ao nome atual e mantém ficheiros antigos a funcionar", async () => {
    const igual = await parseFilledReviewFile(
      csv(`k1,Sofia Vaz,sofia váz,,${ID}`, "id_linha,nome,nome_novo,telefone_novo,search_ids"),
    );
    expect(igual.ignorados).toBe(1);
    const antigo = await parseFilledReviewFile(
      csv(`k1,Sofia Vaz,920505485,${ID}`, "id_linha,nome,telefone_novo,search_ids"),
    );
    expect(antigo.prontos).toBe(1);
    expect(antigo.rows[0]!.nome_novo).toBe("");
  });
});
