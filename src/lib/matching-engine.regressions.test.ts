import { describe, expect, it } from "vitest";
import {
  scoreMatch,
  buildGeoMatchIndex,
  type BuyerLike,
  type PropertyLike,
} from "./matching-engine";
import type { GeoSnapshot, Location } from "@/lib/geo";

// ---------------------------------------------------------------------------
// Release 1.2 — Testes de regressão do Motor Match
// Cobre:
//  1) Tolerância de +10% acima do orçamento máximo (T2 Barreiro 269k vs 260k).
//  2) Localização por zona funcional (Margem Sul cobre Barreiro).
//  3) Moradia para reabilitar + Margem Sul.
//  4) Procura sem tipologia mas com quartos_min continua a filtrar T1.
//  5) Procura sem tipologia e sem quartos_min aceita qualquer tipologia.
// ---------------------------------------------------------------------------

const MARGEM_SUL = "zf-margem-sul";
const BARREIRO = "loc-barreiro";
const ALMADA = "loc-almada";
const SEIXAL = "loc-seixal";
const LISBOA = "loc-lisboa";

function loc(id: string, tipo: Location["tipo"], parent_id: string | null): Location {
  return { id, slug: id, nome: id, tipo, parent_id, aprovado: true };
}

function snap(): GeoSnapshot {
  const locations: Location[] = [
    loc(BARREIRO, "concelho", null),
    loc(ALMADA, "concelho", null),
    loc(SEIXAL, "concelho", null),
    loc(LISBOA, "concelho", null),
    loc(MARGEM_SUL, "zona_funcional", null),
  ];
  return {
    version: 1,
    locations,
    aliases: [],
    bySlug: new Map(locations.map((l) => [l.slug, l])),
    byId: new Map(locations.map((l) => [l.id, l])),
    byAlias: new Map(),
    childrenOf: new Map(),
    adjacentOf: new Map(),
    functionalZoneMembers: new Map([[MARGEM_SUL, [BARREIRO, ALMADA, SEIXAL]]]),
  };
}

const geoIndex = buildGeoMatchIndex(snap());

describe("Release 1.2 — regressões", () => {
  it("tolerância +10% acima do orçamento (T2 Barreiro 269k vs comprador 260k)", () => {
    const buyer: BuyerLike = {
      finalidade: "venda",
      tipo_imovel: ["Apartamento"],
      tipologia: "T2",
      location_ids: [BARREIRO],
      budget_max: 260000,
    };
    const property: PropertyLike = {
      finalidade: "venda",
      tipo_imovel: "Apartamento",
      tipologia: "T2",
      location_id: BARREIRO,
      preco: 269000,
    };
    const r = scoreMatch(buyer, property, { geoIndex });
    expect(r.compatible).toBe(true);
  });

  it("zona funcional Margem Sul cobre imóvel em Barreiro", () => {
    const buyer: BuyerLike = {
      finalidade: "venda",
      tipo_imovel: ["Moradia"],
      tipologia: "T3",
      location_ids: [MARGEM_SUL],
      budget_max: 400000,
    };
    const property: PropertyLike = {
      finalidade: "venda",
      tipo_imovel: "Moradia",
      tipologia: "T3",
      location_id: BARREIRO,
      preco: 380000,
    };
    const r = scoreMatch(buyer, property, { geoIndex });
    expect(r.compatible).toBe(true);
  });

  it("moradia para reabilitar em Margem Sul → match", () => {
    const buyer: BuyerLike = {
      finalidade: "venda",
      tipo_imovel: ["Moradia"],
      tipologia: null,
      location_ids: [MARGEM_SUL],
      budget_max: 250000,
      caracteristicas: ["para reabilitar"],
      resumo: "Procura moradia para reabilitar na margem sul",
    };
    const property: PropertyLike = {
      finalidade: "venda",
      tipo_imovel: "Moradia",
      tipologia: "T2",
      location_id: SEIXAL,
      preco: 220000,
    };
    const r = scoreMatch(buyer, property, { geoIndex });
    expect(r.compatible).toBe(true);
  });

  it("procura sem tipologia + quartos_min=3 rejeita T1 com TIPOLOGIA", () => {
    const buyer: BuyerLike = {
      finalidade: "venda",
      tipo_imovel: ["Apartamento"],
      tipologia: null,
      quartos_min: 3,
      location_ids: [LISBOA],
      budget_max: 500000,
    };
    const property: PropertyLike = {
      finalidade: "venda",
      tipo_imovel: "Apartamento",
      tipologia: "T1",
      quartos: 1,
      location_id: LISBOA,
      preco: 300000,
    };
    const r = scoreMatch(buyer, property, { geoIndex });
    expect(r.compatible).toBe(false);
    expect(r.rejectReason).toBe("TIPOLOGIA");
  });

  it("procura sem tipologia e sem quartos_min aceita qualquer tipologia", () => {
    const buyer: BuyerLike = {
      finalidade: "venda",
      tipo_imovel: ["Apartamento"],
      tipologia: null,
      location_ids: [LISBOA],
      budget_max: 500000,
    };
    const property: PropertyLike = {
      finalidade: "venda",
      tipo_imovel: "Apartamento",
      tipologia: "T1",
      quartos: 1,
      location_id: LISBOA,
      preco: 300000,
    };
    const r = scoreMatch(buyer, property, { geoIndex });
    expect(r.compatible).toBe(true);
  });

  it("rejectReason ORCAMENTO quando preço excede a tolerância", () => {
    const buyer: BuyerLike = {
      finalidade: "venda",
      tipo_imovel: ["Apartamento"],
      tipologia: "T2",
      location_ids: [LISBOA],
      budget_max: 200000,
    };
    const property: PropertyLike = {
      finalidade: "venda",
      tipo_imovel: "Apartamento",
      tipologia: "T2",
      location_id: LISBOA,
      preco: 300000,
    };
    const r = scoreMatch(buyer, property, { geoIndex });
    expect(r.compatible).toBe(false);
    expect(r.rejectReason).toBe("ORCAMENTO");
  });

  it("rejectReason LOCALIZACAO quando fora de todas as áreas", () => {
    const buyer: BuyerLike = {
      finalidade: "venda",
      tipo_imovel: ["Apartamento"],
      tipologia: "T2",
      location_ids: [LISBOA],
      budget_max: 500000,
    };
    const property: PropertyLike = {
      finalidade: "venda",
      tipo_imovel: "Apartamento",
      tipologia: "T2",
      location_id: BARREIRO,
      preco: 300000,
    };
    const r = scoreMatch(buyer, property, { geoIndex });
    expect(r.compatible).toBe(false);
    expect(r.rejectReason).toBe("LOCALIZACAO");
  });
});
