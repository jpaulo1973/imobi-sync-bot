import { describe, it, expect } from "vitest";
import { matchCardKey, notificationTarget } from "./match-notifications.functions";

const P = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("destino da notificação de match", () => {
  it("chave do cartão coincide com a usada nas oportunidades", () => {
    expect(matchCardKey("cliente", B)).toBe(`cliente-${B}`);
    expect(matchCardKey("search", B)).toBe(`search-${B}`);
  });

  it("cliente próprio com imóvel próprio → abre o match do imóvel", () => {
    expect(
      notificationTarget({ buyer_source: "cliente", buyer_ref: B, property_id: P, ownsProperty: true }),
    ).toEqual({ to: "/imoveis", search: { open: P, match: `cliente-${B}` } });
  });

  it("cliente próprio com imóvel de outro → abre o drawer do cliente no imóvel", () => {
    expect(
      notificationTarget({ buyer_source: "cliente", buyer_ref: B, property_id: P, ownsProperty: false }),
    ).toEqual({ to: "/clientes", search: { buyer: B, property: P } });
  });

  it("Admin: procura WhatsApp abre directamente a procura no Radar", () => {
    for (const ownsProperty of [true, false]) {
      expect(
        notificationTarget({ buyer_source: "search", buyer_ref: B, property_id: P, ownsProperty, isAdmin: true }),
      ).toEqual({ to: "/radar", search: { procura: B, property: P } });
    }
  });

  it("consultor (não-admin): procura abre o match na ficha do imóvel", () => {
    for (const ownsProperty of [true, false]) {
      expect(
        notificationTarget({ buyer_source: "search", buyer_ref: B, property_id: P, ownsProperty }),
      ).toEqual({ to: "/imoveis", search: { open: P, match: `search-${B}` } });
    }
  });
});