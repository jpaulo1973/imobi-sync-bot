import { describe, it, expect } from "vitest";
import { matchCardKey, notificationTarget } from "./match-notifications.functions";

const P = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("destino da notificação de match", () => {
  it("chave do cartão coincide com a usada nas oportunidades", () => {
    expect(matchCardKey("cliente", B)).toBe(`cliente-${B}`);
    expect(matchCardKey("search", B)).toBe(`search-${B}`);
  });

  it("imóvel próprio → abre o match do imóvel com o comprador destacado", () => {
    expect(
      notificationTarget({ buyer_source: "cliente", buyer_ref: B, property_id: P, ownsProperty: true }),
    ).toEqual({ to: "/imoveis", search: { open: P, match: `cliente-${B}` } });
    expect(
      notificationTarget({ buyer_source: "search", buyer_ref: B, property_id: P, ownsProperty: true }),
    ).toEqual({ to: "/imoveis", search: { open: P, match: `search-${B}` } });
  });

  it("cliente próprio com imóvel de outro → abre o drawer do cliente no imóvel", () => {
    expect(
      notificationTarget({ buyer_source: "cliente", buyer_ref: B, property_id: P, ownsProperty: false }),
    ).toEqual({ to: "/clientes", search: { buyer: B, property: P } });
  });

  it("procura externa sem posse do imóvel cai no lado do imóvel", () => {
    expect(
      notificationTarget({ buyer_source: "search", buyer_ref: B, property_id: P, ownsProperty: false }),
    ).toEqual({ to: "/imoveis", search: { open: P, match: `search-${B}` } });
  });
});