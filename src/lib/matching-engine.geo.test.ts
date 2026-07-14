import { describe, expect, it } from "vitest";
import {
  scoreMatch,
  buildGeoMatchIndex,
  type BuyerLike,
  type PropertyLike,
} from "./matching-engine";
import type { GeoSnapshot, Location } from "@/lib/geo";

// ---------------------------------------------------------------------------
// Snapshot sintético construído em memória. Só usa as estruturas expostas
// pelo GeoSnapshot (byId, childrenOf, adjacentOf, functionalZoneMembers) —
// sem qualquer dependência de KNOWN_CONCELHOS/ADJACENT.
// ---------------------------------------------------------------------------

const LISBOA = "loc-lisboa";
const ESTRELA = "loc-estrela";
const CAMPO_OURIQUE = "loc-campo-ourique";
const BENFICA = "loc-benfica";
const SETUBAL = "loc-setubal";
const LINHA_CASCAIS = "zf-linha-cascais";
const CASCAIS = "loc-cascais";
const ESTORIL = "loc-estoril";

function loc(id: string, tipo: Location["tipo"], parent_id: string | null): Location {
  return { id, slug: id, nome: id, tipo, parent_id, aprovado: true };
}

function makeSnapshot(): GeoSnapshot {
  const locations: Location[] = [
    loc(LISBOA, "concelho", null),
    loc(ESTRELA, "freguesia", LISBOA),
    loc(CAMPO_OURIQUE, "freguesia", LISBOA),
    loc(BENFICA, "freguesia", LISBOA),
    loc(SETUBAL, "concelho", null),
    loc(CASCAIS, "concelho", null),
    loc(ESTORIL, "freguesia", CASCAIS),
    loc(LINHA_CASCAIS, "zona_funcional", null),
  ];
  const byId = new Map(locations.map((l) => [l.id, l]));
  const childrenOf = new Map<string, string[]>([
    [LISBOA, [ESTRELA, CAMPO_OURIQUE, BENFICA]],
    [CASCAIS, [ESTORIL]],
  ]);
  const adjacentOf = new Map<string, string[]>([
    [ESTRELA, [CAMPO_OURIQUE]],
    [CAMPO_OURIQUE, [ESTRELA]],
  ]);
  const functionalZoneMembers = new Map<string, string[]>([
    [LINHA_CASCAIS, [CASCAIS]],
  ]);
  return {
    version: 1,
    locations,
    aliases: [],
    bySlug: new Map(locations.map((l) => [l.slug, l])),
    byId,
    byAlias: new Map(),
    childrenOf,
    adjacentOf,
    functionalZoneMembers,
  };
}

const BASE_BUYER: BuyerLike = {
  finalidade: "venda",
  tipo_imovel: ["Apartamento"],
  tipologia: "T2",
  budget_max: 500000,
};
const BASE_PROPERTY: PropertyLike = {
  finalidade: "venda",
  tipo_imovel: "Apartamento",
  tipologia: "T2",
  preco: 400000,
  area_util_m2: 80,
  quartos: 2,
};

describe("matching-engine geo (Fase 3 — IDs exclusivamente)", () => {
  const geoIndex = buildGeoMatchIndex(makeSnapshot());

  it("match directo por location_id", () => {
    const r = scoreMatch(
      { ...BASE_BUYER, location_ids: [ESTRELA] },
      { ...BASE_PROPERTY, location_id: ESTRELA },
      { geoIndex },
    );
    expect(r.compatible).toBe(true);
  });

  it("hierarquia ascendente — buyer no concelho, imóvel na freguesia descendente", () => {
    const r = scoreMatch(
      { ...BASE_BUYER, location_ids: [LISBOA] },
      { ...BASE_PROPERTY, location_id: ESTRELA },
      { geoIndex },
    );
    expect(r.compatible).toBe(true);
  });

  it("hierarquia descendente — buyer na freguesia, imóvel no concelho pai", () => {
    const r = scoreMatch(
      { ...BASE_BUYER, location_ids: [ESTRELA] },
      { ...BASE_PROPERTY, location_id: LISBOA },
      { geoIndex },
    );
    expect(r.compatible).toBe(true);
  });

  it("zona funcional cobre membros e seus descendentes", () => {
    const r = scoreMatch(
      { ...BASE_BUYER, location_ids: [LINHA_CASCAIS] },
      { ...BASE_PROPERTY, location_id: ESTORIL },
      { geoIndex },
    );
    expect(r.compatible).toBe(true);
  });

  it("adjacência entre freguesias irmãs", () => {
    const r = scoreMatch(
      { ...BASE_BUYER, location_ids: [ESTRELA] },
      { ...BASE_PROPERTY, location_id: CAMPO_OURIQUE },
      { geoIndex },
    );
    expect(r.compatible).toBe(true);
  });

  it("sem relação — não compatível", () => {
    const r = scoreMatch(
      { ...BASE_BUYER, location_ids: [LISBOA] },
      { ...BASE_PROPERTY, location_id: SETUBAL },
      { geoIndex },
    );
    expect(r.compatible).toBe(false);
  });

  it("buyer sem location_ids → pending_geo (não entra no motor)", () => {
    const r = scoreMatch(
      { ...BASE_BUYER, location_ids: [] },
      { ...BASE_PROPERTY, location_id: ESTRELA },
      { geoIndex },
    );
    expect(r.compatible).toBe(false);
  });

  it("imóvel sem location_id → needsReview freguesia_em_falta", () => {
    const r = scoreMatch(
      { ...BASE_BUYER, location_ids: [LISBOA] },
      { ...BASE_PROPERTY, location_id: null },
      { geoIndex },
    );
    expect(r.compatible).toBe(false);
    expect(r.needsReview?.reviewReason).toBe("freguesia_em_falta");
  });
});