import { describe, expect, it } from "vitest";
import {
  resolveCategory,
  resolveCategories,
  inferCondition,
} from "./property-taxonomy";
import { scoreMatch, buildGeoMatchIndex, type BuyerLike, type PropertyLike } from "./matching-engine";
import type { GeoSnapshot, Location } from "@/lib/geo";

const LX = "loc-lisboa";
function snap(): GeoSnapshot {
  const locations: Location[] = [
    { id: LX, slug: LX, nome: "Lisboa", tipo: "concelho", parent_id: null, aprovado: true },
  ];
  return {
    version: 4,
    locations,
    aliases: [],
    bySlug: new Map(locations.map((l) => [l.slug, l])),
    byId: new Map(locations.map((l) => [l.id, l])),
    byAlias: new Map(),
    childrenOf: new Map(),
    adjacentOf: new Map(),
    functionalZoneMembers: new Map(),
  };
}
const geoIndex = buildGeoMatchIndex(snap());

describe("Item 5 — taxonomia", () => {
  it("normaliza CamelCase e minúsculas para a mesma categoria", () => {
    expect(resolveCategory("Apartamento")).toBe("casas_apartamentos");
    expect(resolveCategory("moradia")).toBe("casas_apartamentos");
    expect(resolveCategory("Espaço comercial")).toBe("comercial_armazens");
    expect(resolveCategory("Lar de idosos")).toBe("trespasses");
    expect(resolveCategory("Herdade")).toBe("herdades_quintas");
    expect(resolveCategory("herdades_quintas")).toBe("herdades_quintas");
    expect(resolveCategory("blah")).toBeNull();
  });

  it("resolve listas sem duplicados", () => {
    expect(resolveCategories(["Apartamento", "moradia", "Terreno"])).toEqual([
      "casas_apartamentos",
      "terrenos",
    ]);
  });

  it("infere estado a partir do texto", () => {
    expect(inferCondition("Moradia para recuperar")).toBe("recuperar");
    expect(inferCondition("Apartamento novo, pronto a habitar")).toBe("novo");
    expect(inferCondition("Apartamento central")).toBeNull();
  });
});

describe("Item 5b — hard filter por categoria", () => {
  const base = { finalidade: "venda", location_ids: [LX], budget_max: 500000 };
  it("T3 não cruza com lar de idosos (trespasse)", () => {
    const buyer: BuyerLike = { ...base, tipo_imovel: ["Apartamento"], tipologia: "T3" };
    const property: PropertyLike = {
      finalidade: "venda",
      tipo_imovel: "lar de idosos",
      categoria: "trespasses",
      tipologia: "T3",
      location_id: LX,
      preco: 400000,
    };
    const r = scoreMatch(buyer, property, { geoIndex });
    expect(r.compatible).toBe(false);
    expect(r.rejectReason).toBe("TIPO_IMOVEL");
  });

  it("apartamento cruza com moradia dentro da mesma categoria", () => {
    const buyer: BuyerLike = { ...base, tipo_imovel: ["Apartamento", "Moradia"], tipologia: "T3" };
    const property: PropertyLike = {
      finalidade: "venda",
      tipo_imovel: "moradia",
      categoria: "casas_apartamentos",
      tipologia: "T3",
      location_id: LX,
      preco: 400000,
    };
    expect(scoreMatch(buyer, property, { geoIndex }).compatible).toBe(true);
  });
});

describe("Item 5e — orçamento condicional ao estado", () => {
  const buyer: BuyerLike = {
    finalidade: "venda",
    tipo_imovel: ["Moradia"],
    location_ids: [LX],
    budget_max_obras: 200000,
    budget_max_pronto: 400000,
  };
  const prop = (extra: Partial<PropertyLike>): PropertyLike => ({
    finalidade: "venda",
    tipo_imovel: "moradia",
    categoria: "casas_apartamentos",
    tipologia: "T3",
    location_id: LX,
    ...extra,
  });

  it("imóvel para recuperar usa o orçamento de obras", () => {
    expect(scoreMatch(buyer, prop({ preco: 250000, estado: "recuperar" }), { geoIndex }).compatible).toBe(false);
    expect(scoreMatch(buyer, prop({ preco: 190000, estado: "recuperar" }), { geoIndex }).compatible).toBe(true);
  });

  it("imóvel pronto usa o orçamento superior", () => {
    expect(scoreMatch(buyer, prop({ preco: 380000, estado: "novo" }), { geoIndex }).compatible).toBe(true);
  });

  it("fallback ao orçamento único quando não há condicionais", () => {
    const b: BuyerLike = { finalidade: "venda", tipo_imovel: ["Moradia"], location_ids: [LX], budget_max: 300000 };
    expect(scoreMatch(b, prop({ preco: 290000 }), { geoIndex }).compatible).toBe(true);
    expect(scoreMatch(b, prop({ preco: 400000 }), { geoIndex }).compatible).toBe(false);
  });

  it("estado desejado rejeita estado incompatível", () => {
    const b: BuyerLike = {
      finalidade: "venda",
      tipo_imovel: ["Moradia"],
      location_ids: [LX],
      budget_max: 500000,
      estado_desejado: "recuperar",
    };
    expect(scoreMatch(b, prop({ preco: 300000, estado: "novo" }), { geoIndex }).compatible).toBe(false);
    expect(scoreMatch(b, prop({ preco: 300000, estado: "recuperar" }), { geoIndex }).compatible).toBe(true);
  });
});
