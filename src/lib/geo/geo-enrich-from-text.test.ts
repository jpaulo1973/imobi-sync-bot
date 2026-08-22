import { describe, expect, it } from "vitest";
import { indexSnapshot } from "./location-repository";
import { enrichRecordGeo, districtIdFromText } from "./geo-enrich-from-text";
import type { Location } from "./geo-types";

const loc = (
  id: string,
  nome: string,
  tipo: Location["tipo"],
  parent_id: string | null = null,
): Location => ({ id, slug: id, nome, tipo, parent_id, aprovado: true });

const locations = [
  loc("d-setubal", "Setúbal", "distrito"),
  loc("c-setubal", "Setúbal", "concelho", "d-setubal"),
  loc("c-almada", "Almada", "concelho", "d-setubal"),
  loc("f-cacilhas", "Cacilhas", "freguesia", "c-almada"),
  loc("c-grandola", "Grândola", "concelho", "d-setubal"),
  loc("f-carvalhal-grandola", "Carvalhal", "freguesia", "c-grandola"),
  loc("d-lisboa", "Lisboa", "distrito"),
  loc("c-lisboa", "Lisboa", "concelho", "d-lisboa"),
  loc("c-cascais", "Cascais", "concelho", "d-lisboa"),
];

const snap = indexSnapshot(9, locations, [], [], []);

describe("enrichRecordGeo — preenche a partir do texto original", () => {
  it('"Vale Flores, Almada" resolve para o concelho Almada', () => {
    const r = enrichRecordGeo(
      {
        fields: { distrito: "Setubal", zona: "Vale Flores" },
        texto: "Procuro Apartamento T2 em Vale Flores, Almada, pagamento a pronto.",
        current_ids: ["d-setubal"],
      },
      snap,
    );
    expect(r.classe).toBe("preenche");
    expect(r.location_ids).toEqual(["c-almada"]);
    expect(r.location_ids).not.toContain("d-setubal");
    expect(r.level).toBe("concelho");
  });

  it("prefere a freguesia (folha) quando o texto traz concelho + freguesia", () => {
    const r = enrichRecordGeo(
      {
        fields: { distrito: "Setúbal" },
        texto: "T2 em Cacilhas, Almada",
        current_ids: ["d-setubal"],
      },
      snap,
    );
    expect(r.classe).toBe("preenche");
    expect(r.location_ids).toEqual(["f-cacilhas"]);
  });

  it("preenche também quando não há nada gravado (sem distrito)", () => {
    const r = enrichRecordGeo({ fields: {}, texto: "Compro apartamento em Cascais" }, snap);
    expect(r.classe).toBe("preenche");
    expect(r.location_ids).toEqual(["c-cascais"]);
  });
});

describe("enrichRecordGeo — comparação de distrito insensível a acentos/maiúsculas", () => {
  it('"Setubal" e "Setúbal" são o mesmo distrito', () => {
    expect(districtIdFromText("Setubal", snap)).toBe("d-setubal");
    expect(districtIdFromText("SETÚBAL", snap)).toBe("d-setubal");
    expect(districtIdFromText("setubal", snap)).toBe(districtIdFromText("Setúbal", snap));
  });

  it("distrito gravado sem acento não gera divergência com texto acentuado", () => {
    const r = enrichRecordGeo(
      { fields: { distrito: "setubal" }, texto: "Quinta em Grândola" },
      snap,
    );
    expect(r.classe).toBe("preenche");
    expect(r.location_ids).toEqual(["c-grandola"]);
  });

  it('"lisboa" minúsculo é coerente com concelho de Cascais no texto', () => {
    const r = enrichRecordGeo({ fields: { distrito: "lisboa" }, texto: "T3 em Cascais" }, snap);
    expect(r.classe).toBe("preenche");
    expect(r.location_ids).toEqual(["c-cascais"]);
  });
});

describe("enrichRecordGeo — nunca sobrepõe, sinaliza divergência", () => {
  it("texto fora do distrito gravado → divergência (não escreve)", () => {
    const r = enrichRecordGeo(
      { fields: { distrito: "Setúbal" }, texto: "T2 em Cascais", current_ids: ["d-setubal"] },
      snap,
    );
    expect(r.classe).toBe("divergencia");
    expect(r.location_ids).toEqual([]);
    expect(r.motivo).toContain("fora do distrito");
  });

  it("vários concelhos no texto → divergência", () => {
    const r = enrichRecordGeo(
      { fields: { distrito: "Setúbal" }, texto: "Procuro em Almada ou Grândola" },
      snap,
    );
    expect(r.classe).toBe("divergencia");
    expect(r.motivo).toContain("concelhos diferentes");
  });

  it("registo com concelho já gravado fica em mantém, inalterado", () => {
    const r = enrichRecordGeo(
      {
        fields: { distrito: "Setúbal", concelho: "Grândola" },
        texto: "T2 em Cascais",
        current_ids: ["c-grandola"],
      },
      snap,
    );
    expect(r.classe).toBe("mantem");
    expect(r.location_ids).toEqual([]);
  });

  it("regressão: qualquer registo com freguesia/concelho/zona resolvida fica em mantém", () => {
    const casos = [
      { fields: { freguesia: "Cacilhas" }, current_ids: ["f-cacilhas"] },
      { fields: { concelho: "Almada" }, current_ids: ["c-almada"] },
      { fields: { zona: "Cascais" }, current_ids: ["c-cascais"] },
      { fields: { distrito: "Setúbal", concelho: "Almada" }, current_ids: [] },
    ];
    for (const c of casos) {
      const r = enrichRecordGeo({ ...c, texto: "T2 em Grândola" }, snap);
      expect(r.classe).toBe("mantem");
      expect(r.location_ids).toEqual([]);
    }
  });
});

describe("enrichRecordGeo — confiança e ausência de informação", () => {
  it("sem texto original → sem_info", () => {
    const r = enrichRecordGeo(
      { fields: { distrito: "Setúbal" }, texto: null, current_ids: ["d-setubal"] },
      snap,
    );
    expect(r.classe).toBe("sem_info");
  });

  it("texto sem localização reconhecível → sem_info", () => {
    const r = enrichRecordGeo(
      { fields: { distrito: "Setúbal" }, texto: "Procuro T2 em Vale Flores", current_ids: ["d-setubal"] },
      snap,
    );
    expect(r.classe).toBe("sem_info");
    expect(r.location_ids).toEqual([]);
  });

  it("limiar de confiança respeitado → baixa_confianca", () => {
    const r = enrichRecordGeo(
      { fields: { distrito: "Setúbal" }, texto: "T2 em Almada" },
      snap,
      { minConfidence: 99 },
    );
    expect(r.classe).toBe("baixa_confianca");
    expect(r.location_ids).toEqual([]);
    expect(r.motivo).toContain("Confiança");
  });
});

describe("C0440-00927 — falso positivo desaparece após enriquecimento", () => {
  it("procura ancorada em Setúbal[distrito] passa a Almada[concelho] e deixa de cobrir Carvalhal/Grândola", () => {
    const r = enrichRecordGeo(
      {
        fields: { distrito: "Setubal", zona: "Vale Flores" },
        texto: "Procuro Apartamento T2 em Vale Flores, Almada, pagamento a pronto.",
        current_ids: ["d-setubal"],
      },
      snap,
    );
    expect(r.location_ids).toEqual(["c-almada"]);
    // O imóvel C0440-00927 está em Carvalhal (Grândola): já não é coberto,
    // porque o distrito Setúbal deixou de estar nos location_ids da procura.
    const cobre = (searchIds: string[], propId: string) => {
      const chain: string[] = [propId];
      let cur = snap.byId.get(propId)?.parent_id ?? null;
      while (cur) {
        chain.push(cur);
        cur = snap.byId.get(cur)?.parent_id ?? null;
      }
      return searchIds.some((id) => chain.includes(id));
    };
    expect(cobre(["d-setubal"], "f-carvalhal-grandola")).toBe(true); // antes
    expect(cobre(r.location_ids, "f-carvalhal-grandola")).toBe(false); // depois
  });
});
