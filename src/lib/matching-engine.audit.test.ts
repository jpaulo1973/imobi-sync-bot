import { describe, expect, it } from "vitest";
import {
  evaluateExhaustive,
  scoreMatch,
  type BuyerLike,
  type PropertyLike,
  type GeoMatchIndex,
} from "./matching-engine";

// Índice mínimo — sem hierarquia/adjacência, para testes puros.
const emptyGeo: GeoMatchIndex = {
  parentsOf: () => [],
  childrenOf: () => [],
  adjacentOf: () => [],
  functionalMembersOf: () => [],
  nameOf: (id) => id === LOC_LISBOA ? "Lisboa" : id === LOC_PORTO ? "Porto" : null,
};

const LOC_LISBOA = "00000000-0000-0000-0000-00000000lisb";
const LOC_PORTO = "00000000-0000-0000-0000-00000000port";

describe("evaluateExhaustive — Sprint 1.2.1", () => {
  const baseBuyer: BuyerLike = {
    finalidade: "venda",
    tipo_imovel: ["apartamento"],
    tipologia: "T2",
    location_ids: [LOC_LISBOA],
    budget_max: 300000,
    area_min: 80,
  };
  const baseProp: PropertyLike = {
    finalidade: "venda",
    tipo_imovel: "apartamento",
    tipologia: "T2",
    location_id: LOC_LISBOA,
    preco: 285000,
    area_util_m2: 90,
    quartos: 2,
  };

  it("não interrompe: reporta TODOS os filtros mesmo com múltiplas falhas", () => {
    // Localização errada + área insuficiente + preço acima → 3 falhas.
    const prop: PropertyLike = {
      ...baseProp,
      location_id: LOC_PORTO,
      area_util_m2: 40,
      preco: 500000,
    };
    const r = evaluateExhaustive(baseBuyer, prop, { geoIndex: emptyGeo });
    expect(r.compatible).toBe(false);
    // Deve reportar todas as categorias avaliadas (finalidade, tipo, tipo(investor), localização, área, extras, preço, tipologia).
    const keys = r.categories.map((c) => c.key);
    expect(keys).toContain("finalidade");
    expect(keys).toContain("tipo");
    expect(keys).toContain("localizacao");
    expect(keys).toContain("area");
    expect(keys).toContain("preco");
    expect(keys).toContain("tipologia");
    // Múltiplas falhas expostas simultaneamente.
    expect(r.failedCount).toBeGreaterThanOrEqual(3);
  });

  it("shortCircuitAt coincide com rejectReason de scoreMatch", () => {
    const prop: PropertyLike = { ...baseProp, location_id: LOC_PORTO };
    const audit = evaluateExhaustive(baseBuyer, prop, { geoIndex: emptyGeo });
    const normal = scoreMatch(baseBuyer, prop, { geoIndex: emptyGeo });
    expect(normal.compatible).toBe(false);
    expect(audit.compatible).toBe(false);
    expect(audit.shortCircuitAt?.rejectReason).toBe(normal.rejectReason);
  });

  it("caso compatível: shortCircuitAt = null e score > 0", () => {
    const r = evaluateExhaustive(baseBuyer, baseProp, { geoIndex: emptyGeo });
    expect(r.compatible).toBe(true);
    expect(r.shortCircuitAt).toBeNull();
    expect(r.score).toBeGreaterThan(0);
  });

  it("cada categoria expõe expected/actual/rule legíveis", () => {
    const r = evaluateExhaustive(baseBuyer, baseProp, { geoIndex: emptyGeo });
    for (const c of r.categories) {
      expect(typeof c.expected).toBe("string");
      expect(typeof c.actual).toBe("string");
      expect(typeof c.rule).toBe("string");
    }
    const loc = r.categories.find((c) => c.key === "localizacao");
    expect(loc?.expected).toContain("Lisboa");
    expect(loc?.actual).toContain("Lisboa");
  });

  it("scoreMatch permanece com short-circuit (regressão)", () => {
    // scoreMatch tem que continuar a devolver apenas a categoria da falha (curto-circuito).
    const prop: PropertyLike = { ...baseProp, location_id: LOC_PORTO, preco: 999999 };
    const r = scoreMatch(baseBuyer, prop, { geoIndex: emptyGeo });
    expect(r.compatible).toBe(false);
    // Apenas 1 categoria (a que falhou), não corre soft nem preço a seguir.
    expect(r.categories.length).toBe(1);
    expect(r.categories[0].key).toBe("localizacao");
  });
});