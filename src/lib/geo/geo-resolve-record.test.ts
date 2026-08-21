import { describe, expect, it } from "vitest";
import { indexSnapshot } from "./location-repository";
import { resolveRecordLocation } from "./geo-resolve-record";
import { classifyProperty, classifySearch, losesLevel } from "./homonym-backfill";
import type { Location } from "./geo-types";

const loc = (
  id: string,
  nome: string,
  tipo: Location["tipo"],
  parent_id: string | null = null,
): Location => ({ id, slug: id, nome, tipo, parent_id, aprovado: true });

// Recorte real do problema: distritos homónimos dos concelhos + freguesias
// "Carvalhal" repetidas em vários concelhos.
const locations = [
  loc("d-setubal", "Setúbal", "distrito"),
  loc("c-setubal", "Setúbal", "concelho", "d-setubal"),
  loc("c-grandola", "Grândola", "concelho", "d-setubal"),
  loc("f-carvalhal-grandola", "Carvalhal", "freguesia", "c-grandola"),
  loc("f-azeitao", "Azeitão", "freguesia", "c-setubal"),
  loc("d-lisboa", "Lisboa", "distrito"),
  loc("c-lisboa", "Lisboa", "concelho", "d-lisboa"),
  loc("d-porto", "Porto", "distrito"),
  loc("c-porto", "Porto", "concelho", "d-porto"),
  loc("d-leiria", "Leiria", "distrito"),
  loc("c-bombarral", "Carvalhal", "concelho", "d-leiria"),
  loc("f-carvalhal-bombarral", "Carvalhal", "freguesia", "c-bombarral"),
  loc("d-viseu", "Viseu", "distrito"),
  loc("c-viseu", "Viseu", "concelho", "d-viseu"),
  loc("f-carvalhal-viseu", "Carvalhal", "freguesia", "c-viseu"),
];

const snap = indexSnapshot(9, locations, [], [], []);

describe("resolveRecordLocation — homónimos distrito/concelho", () => {
  it("C0440-00927: concelho=Grândola + freguesia=Carvalhal nunca dá concelho Setúbal", () => {
    const r = resolveRecordLocation(
      { distrito: "Setúbal", concelho: "Grândola", freguesia: "Carvalhal", zona: "Tróia" },
      snap,
    );
    expect(r.location_id).toBe("f-carvalhal-grandola");
    expect(r.location_ids).not.toContain("c-setubal");
    expect(r.concelho_id).toBe("c-grandola");
    expect(r.level).toBe("freguesia");
  });

  it("descarta zona homónima do distrito quando o concelho em texto é outro", () => {
    const r = resolveRecordLocation(
      { distrito: "Setúbal", concelho: "Grândola", zona: "Setúbal" },
      snap,
    );
    expect(r.location_id).toBe("c-grandola");
    expect(r.location_ids).toEqual(["c-grandola"]);
    expect(r.discarded).toEqual([
      { field: "zona", raw: "Setúbal", ids: ["c-setubal"], reason: "fora_contexto" },
    ]);
  });

  it("freguesia homónima em vários concelhos: desambigua pelo pai", () => {
    const r = resolveRecordLocation({ concelho: "Viseu", freguesia: "Carvalhal" }, snap);
    expect(r.location_id).toBe("f-carvalhal-viseu");
  });

  it("freguesia homónima sem contexto fica ambígua e não escolhe silenciosamente", () => {
    const r = resolveRecordLocation({ freguesia: "Carvalhal" }, snap);
    expect(r.location_id).toBeNull();
    expect(r.discarded[0]!.reason).toBe("ambiguo");
    expect(r.discarded[0]!.ids.length).toBe(3);
  });

  it("texto de concelho vence: freguesia fora do concelho é conflito, não promove", () => {
    const r = resolveRecordLocation({ concelho: "Grândola", freguesia: "Azeitão" }, snap);
    expect(r.location_id).toBe("c-grandola");
    expect(r.conflict).toBe(true);
    expect(r.discarded[0]).toEqual({
      field: "freguesia",
      raw: "Azeitão",
      ids: ["f-azeitao"],
      reason: "fora_contexto",
    });
  });

  it("distrito homónimo sozinho resolve o distrito, não o concelho", () => {
    const r = resolveRecordLocation({ distrito: "Setúbal" }, snap);
    expect(r.location_id).toBe("d-setubal");
  });
});

describe("NÃO-REGRESSÃO — as 255 procuras com distrito+zona homónimos", () => {
  // Padrão real das procuras em produção: só `distrito` e `zona` com o mesmo
  // nome ("Lisboa", "Porto", "Setúbal"), sem `municipio` nem `freguesia`.
  // Estas procuras estão ancoradas no CONCELHO homónimo e NÃO podem mudar.
  const casos: Array<[string, string]> = [
    ["Lisboa", "c-lisboa"],
    ["Porto", "c-porto"],
    ["Setúbal", "c-setubal"],
  ];

  for (const [nome, esperado] of casos) {
    it(`${nome}: distrito+zona homónimos mantêm o ID atual (${esperado})`, () => {
      const r = resolveRecordLocation({ distrito: nome, zona: nome }, snap);
      expect(r.location_ids).toEqual([esperado]);
      expect(r.conflict).toBe(false);
      expect(classifySearch([esperado], r, snap)).toBe("mantem");
    });
  }

  it("variantes com zona minúscula ou só zona também mantêm", () => {
    expect(
      classifySearch(["c-porto"], resolveRecordLocation({ distrito: "Porto", zona: "porto" }, snap), snap),
    ).toBe("mantem");
    expect(
      classifySearch(["c-lisboa"], resolveRecordLocation({ zona: "Lisboa" }, snap), snap),
    ).toBe("mantem");
  });
});

describe("classificação do backfill", () => {
  const grandola = resolveRecordLocation(
    { distrito: "Setúbal", concelho: "Grândola", freguesia: "Carvalhal" },
    snap,
  );

  it("corrige quando o ID atual contradiz o texto", () => {
    expect(classifyProperty("c-setubal", grandola, snap)).toBe("corrige");
  });

  it("especializa quando o atual é ancestral do novo", () => {
    expect(classifyProperty("c-grandola", grandola, snap)).toBe("especializa");
    expect(classifyProperty("d-setubal", grandola, snap)).toBe("especializa");
  });

  it("mantem quando é igual", () => {
    expect(classifyProperty("f-carvalhal-grandola", grandola, snap)).toBe("mantem");
  });

  it("conflito nunca é gravável", () => {
    const conflito = resolveRecordLocation({ concelho: "Grândola", freguesia: "Azeitão" }, snap);
    expect(classifyProperty("c-grandola", conflito, snap)).toBe("conflito");
    expect(classifySearch(["c-grandola"], conflito, snap)).toBe("conflito");
  });

  it("mantem quando o texto não resolve nada", () => {
    const nada = resolveRecordLocation({ zona: "Marbella" }, snap);
    expect(classifyProperty("c-setubal", nada, snap)).toBe("mantem");
    expect(classifySearch(["c-setubal"], nada, snap)).toBe("mantem");
  });
});

describe("padrões de substituição do backfill (dry-run 21/08)", () => {
  it("freguesia noutro concelho: substitui o concelho homónimo pelo real", () => {
    // Padrão dos 101 casos "Lisboa/Porto/Setúbal -> outro concelho".
    const r = resolveRecordLocation(
      { distrito: "Setúbal", concelho: "Grândola", freguesia: "Carvalhal" },
      snap,
    );
    expect(r.location_ids).toEqual(["f-carvalhal-grandola"]);
    expect(classifySearch(["c-setubal"], r, snap)).toBe("corrige");
    expect(losesLevel("c-setubal", r.location_id, snap)).toBe(false);
  });

  it("falso positivo de zona removido: zona fora do contexto não entra nos IDs", () => {
    // Padrão dos 64 casos "concelho -> (removido)": a zona em texto livre
    // resolvia um concelho aleatório e o contexto agora descarta-o.
    const r = resolveRecordLocation(
      { distrito: "Lisboa", concelho: "Lisboa", zona: "Porto" },
      snap,
    );
    expect(r.location_ids).toEqual(["c-lisboa"]);
    expect(r.discarded).toEqual([
      { field: "zona", raw: "Porto", ids: ["c-porto"], reason: "fora_contexto" },
    ]);
    expect(classifySearch(["c-lisboa", "c-porto"], r, snap)).toBe("corrige");
  });

  it("alargamento concelho→distrito só com distrito em texto: perde nível e fica de fora", () => {
    const r = resolveRecordLocation({ distrito: "Leiria" }, snap);
    expect(r.location_id).toBe("d-leiria");
    // Imóvel ancorado numa freguesia de Leiria não deve recuar para o distrito.
    expect(losesLevel("c-bombarral", r.location_id, snap)).toBe(true);
    expect(losesLevel("f-carvalhal-bombarral", r.location_id, snap)).toBe(true);
  });

  it("união de freguesias em falta: freguesia→concelho é perda de nível", () => {
    // Caso real C0440-00971/00969 (União de Vagos e Santo António).
    const r = resolveRecordLocation({ concelho: "Grândola", zona: "Tróia" }, snap);
    expect(r.location_id).toBe("c-grandola");
    expect(losesLevel("f-carvalhal-grandola", r.location_id, snap)).toBe(true);
    expect(losesLevel("d-setubal", r.location_id, snap)).toBe(false);
  });
});
