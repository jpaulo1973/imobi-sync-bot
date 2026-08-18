import { describe, expect, it } from "vitest";
import { detectOfferPosing } from "./offer-detect";

describe("detectOfferPosing", () => {
  it("sinaliza anúncios de venda", () => {
    expect(detectOfferPosing("Alcântara Lofts – Apartamento T0 inserido no empreendimento")).not.toBeNull();
    expect(detectOfferPosing("Moradia T3 em Sintra. Vende-se. Marque a sua visita")).not.toBeNull();
  });

  it("não sinaliza procuras, mesmo com linguagem comercial", () => {
    expect(
      detectOfferPosing("📢 Procuro Apartamento para Cliente Comprador – Lisboa, até 370.000 €"),
    ).toBeNull();
    expect(
      detectOfferPosing("OPORTUNIDADE DE INVESTIMENTO. Procuro INVESTIDOR COM CAPITAIS"),
    ).toBeNull();
    expect(detectOfferPosing("Tenho cliente para T2 em Cascais, empreendimento novo")).toBeNull();
  });

  it("ignora texto vazio", () => {
    expect(detectOfferPosing(null, "")).toBeNull();
  });
});
