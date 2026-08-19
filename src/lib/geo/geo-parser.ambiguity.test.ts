import { describe, expect, it } from "vitest";
import { indexSnapshot } from "./location-repository";
import { parseLocations } from "./geo-parser";
import type { Location, LocationAlias } from "./geo-types";

const loc = (id: string, nome: string, tipo: Location["tipo"], parent_id: string | null = null): Location => ({
  id, slug: id, nome, tipo, parent_id, aprovado: true,
});

const alias = (id: string, a: string, ids: string[]): LocationAlias => ({
  id, alias_normalizado: a, location_ids: ids, origem: "test", aprovado: true, times_used: 0, last_used_at: null,
});

const locations = [
  loc("d-porto", "Porto", "distrito"),
  loc("c-porto", "Porto", "concelho", "d-porto"),
  loc("f-miragaia-porto", "Miragaia", "freguesia", "c-porto"),
  loc("d-lisboa", "Lisboa", "distrito"),
  loc("c-lourinha", "Lourinhã", "concelho", "d-lisboa"),
  loc("f-miragaia-lourinha", "Miragaia", "freguesia", "c-lourinha"),
  loc("zf-oeste", "Zona Oeste", "zona_funcional"),
];

const snap = indexSnapshot(
  5,
  locations,
  [
    alias("a-mira", "miragaia", ["f-miragaia-porto", "f-miragaia-lourinha"]),
    alias("a-portoall", "grande porto", ["c-porto", "f-miragaia-porto"]),
    alias("a-oeste", "oeste", ["zf-oeste", "c-lourinha"]),
  ],
  [],
  [{ functional_zone_id: "zf-oeste", location_id: "c-lourinha" }],
);

describe("alias ambíguo → revisão manual", () => {
  it("não escolhe silenciosamente quando o alias aponta para hierarquias distintas", () => {
    const r = parseLocations("Miragaia", snap, { field: "livre" });
    expect(r.resolved).toEqual([]);
    expect(r.unresolved).toEqual(["Miragaia"]);
    expect(r.confidence).toBe(0);
    expect(r.segments[0].ambiguous_ids).toEqual(["f-miragaia-porto", "f-miragaia-lourinha"]);
    expect(r.aliases_used).toEqual([]); // não incrementa times_used
    expect(r.audit_trail.some((s) => s.step === "alias_ambiguous")).toBe(true);
  });

  it("aceita alias multi-id dentro da mesma hierarquia (pai + filho)", () => {
    const r = parseLocations("Grande Porto", snap, { field: "livre" });
    expect(r.resolved.sort()).toEqual(["c-porto", "f-miragaia-porto"].sort());
    expect(r.confidence).toBe(95);
  });

  it("aceita alias multi-id de zona funcional com os seus membros", () => {
    const r = parseLocations("Oeste", snap, { field: "livre" });
    expect(r.resolved.sort()).toEqual(["c-lourinha", "zf-oeste"].sort());
    expect(r.unresolved).toEqual([]);
  });
});
