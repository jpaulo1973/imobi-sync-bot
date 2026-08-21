import { describe, expect, it } from "vitest";
import { buildGeoMatchIndex, type PropertyLike } from "./matching-engine";
import type { GeoSnapshot, Location } from "@/lib/geo";
import {
  buyerIdentityKey,
  criteriaToBuyer,
  dedupByIdentity,
  countMatchesForProperties,
} from "./property-match-counts";

// ---------------------------------------------------------------------------
// Release 1.3.0 — Contagens de compradores compatíveis na perspetiva do DONO
// ---------------------------------------------------------------------------

const BARREIRO = "loc-barreiro";
const LISBOA = "loc-lisboa";

function loc(id: string): Location {
  return { id, slug: id, nome: id, tipo: "concelho", parent_id: null, aprovado: true };
}

function snap(): GeoSnapshot {
  const locations: Location[] = [loc(BARREIRO), loc(LISBOA)];
  return {
    version: 1,
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

const OWNER_A = "user-admin";
const OWNER_B = "user-outro";

function prop(id: string, user_id: string, location_id = BARREIRO): PropertyLike & Record<string, any> {
  return {
    id,
    user_id,
    finalidade: "venda",
    tipo_imovel: "Apartamento",
    tipologia: "T2",
    location_id,
    preco: 250000,
    area_util: 90,
    quartos: 2,
  } as any;
}

function buyer(id: string, extra: Record<string, any> = {}) {
  return {
    id,
    finalidade: "venda",
    tipo_imovel: ["Apartamento"],
    tipologia: "T2",
    location_ids: [BARREIRO],
    budget_max: 300000,
    ...extra,
  };
}

describe("Release 1.3.0 — countMatchesForProperties", () => {
  it("1) imóvel de outro dono conta os compradores do seu próprio dono (bug original)", () => {
    const properties = [prop("p-outro", OWNER_B)];
    const buyersByOwner = new Map<string, any[]>([
      [OWNER_B, [buyer("b1", { telefone: "912345678" }), buyer("b2", { telefone: "913333333" })]],
    ]);
    const counts = countMatchesForProperties({
      properties,
      buyersByOwner,
      searches: [],
      geoIndex,
    });
    expect(counts["p-outro"]).toBe(2);
  });

  it("2) não mistura compradores entre donos", () => {
    const properties = [prop("p-a", OWNER_A), prop("p-b", OWNER_B)];
    const buyersByOwner = new Map<string, any[]>([
      [OWNER_A, [buyer("a1", { telefone: "911111111" })]],
      [OWNER_B, [buyer("b1", { telefone: "922222222" }), buyer("b2", { telefone: "933333333" })]],
    ]);
    const counts = countMatchesForProperties({
      properties,
      buyersByOwner,
      searches: [],
      geoIndex,
    });
    expect(counts["p-a"]).toBe(1);
    expect(counts["p-b"]).toBe(2);
  });

  it("3) Base Global (active_searches) aplica-se a qualquer dono", () => {
    const properties = [prop("p-a", OWNER_A), prop("p-b", OWNER_B)];
    const searches = [
      {
        id: "s1",
        location_ids: [BARREIRO],
        contact_telefone: "944444444",
        criteria: {
          finalidade: "venda",
          tipo_imovel: ["Apartamento"],
          tipologia: "T2",
          budget_max: 300000,
        },
      },
    ];
    const counts = countMatchesForProperties({
      properties,
      buyersByOwner: new Map(),
      searches,
      geoIndex,
    });
    expect(counts["p-a"]).toBe(1);
    expect(counts["p-b"]).toBe(1);
  });

  it("4) descartes (match_states) da sessão removem o par", () => {
    const properties = [prop("p-b", OWNER_B)];
    const buyersByOwner = new Map<string, any[]>([
      [OWNER_B, [buyer("b1", { telefone: "912345678" }), buyer("b2", { telefone: "913333333" })]],
    ]);
    const counts = countMatchesForProperties({
      properties,
      buyersByOwner,
      searches: [],
      geoIndex,
      dismissed: new Set(["p-b|cliente-b1"]),
    });
    expect(counts["p-b"]).toBe(1);
  });

  it("5) deduplica por identidade (mesmo telefone em cliente e procura global)", () => {
    const properties = [prop("p-a", OWNER_A)];
    const buyersByOwner = new Map<string, any[]>([
      [OWNER_A, [buyer("a1", { telefone: "+351 912 345 678", nome: "Ana" })]],
    ]);
    const searches = [
      {
        id: "s1",
        location_ids: [BARREIRO],
        contact_telefone: "00351912345678",
        criteria: {
          finalidade: "venda",
          tipo_imovel: ["Apartamento"],
          tipologia: "T2",
          budget_max: 300000,
        },
      },
    ];
    const counts = countMatchesForProperties({
      properties,
      buyersByOwner,
      searches,
      geoIndex,
    });
    expect(counts["p-a"]).toBe(1);
  });

  it("6) imóvel incompatível (outra localização) fica a 0", () => {
    const properties = [prop("p-lisboa", OWNER_B, LISBOA)];
    const buyersByOwner = new Map<string, any[]>([
      [OWNER_B, [buyer("b1", { telefone: "912345678" })]],
    ]);
    const counts = countMatchesForProperties({
      properties,
      buyersByOwner,
      searches: [],
      geoIndex,
    });
    expect(counts["p-lisboa"]).toBe(0);
  });
});

describe("helpers puros", () => {
  it("buyerIdentityKey prefere telefone, depois nome, depois fallback", () => {
    expect(buyerIdentityKey("+351 912 345 678", "Ana", "x")).toBe("phone:912345678");
    expect(buyerIdentityKey(null, "  Ána  Silva ", "x")).toBe("name:ana silva");
    expect(buyerIdentityKey(null, null, "cliente:1")).toBe("cliente:1");
  });

  it("criteriaToBuyer converte finalidade indefinida e características", () => {
    const b = criteriaToBuyer(
      { finalidade: "indefinido", caracteristicas: ["Garagem", "Elevador"] },
      [BARREIRO],
    );
    expect(b.finalidade).toBeUndefined();
    expect(b.garagem_obrigatoria).toBe(true);
    expect(b.elevador_obrigatorio).toBe(true);
    expect(b.location_ids).toEqual([BARREIRO]);
  });

  it("dedupByIdentity mantém o melhor score por identidade", () => {
    const out = dedupByIdentity([
      { identity: "phone:1", opp: { score: 50, tag: "a" } },
      { identity: "phone:1", opp: { score: 80, tag: "b" } },
      { identity: "phone:2", opp: { score: 10, tag: "c" } },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((o: any) => o.tag === "b")).toBeTruthy();
  });
});
