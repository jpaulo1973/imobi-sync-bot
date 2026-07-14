import { describe, expect, it } from "vitest";
import { evaluateSearchAcceptance } from "./excel-import.functions";

describe("evaluateSearchAcceptance — fluxos Compra e Arrendamento", () => {
  it("aceita Compra + Comprador (texto explícito)", () => {
    const r = evaluateSearchAcceptance({
      text: "Tenho comprador aprovado para crédito, T2 em Almada até 300000€",
      finalidade: "venda",
      hasStructured: true,
    });
    expect(r.kind).toBe("aceite");
  });

  it("aceita Compra + Investidor", () => {
    const r = evaluateSearchAcceptance({
      text: "Investidor procura projeto aprovado com mais de 80 frações em Lisboa",
      finalidade: "venda",
      hasStructured: true,
    });
    expect(r.kind).toBe("aceite");
  });

  it("aceita Arrendamento + Inquilino", () => {
    const r = evaluateSearchAcceptance({
      text: "Cliente pretende arrendar T2 em Alcochete, 2000€/mês",
      finalidade: "arrendamento",
      hasStructured: true,
    });
    expect(r.kind).toBe("aceite");
  });

  it("aceita procura de Arrendamento estruturada sem texto livre (bug reportado)", () => {
    const r = evaluateSearchAcceptance({
      text: null,
      finalidade: "arrendamento",
      hasStructured: true,
    });
    expect(r.kind).toBe("aceite");
  });

  it("aceita procura de Compra estruturada sem texto livre", () => {
    const r = evaluateSearchAcceptance({
      text: null,
      finalidade: "venda",
      hasStructured: true,
    });
    expect(r.kind).toBe("aceite");
  });

  it("envia Compra + Inquilino para revisão (incoerente)", () => {
    const r = evaluateSearchAcceptance({
      text: "Cliente pretende arrendar T1 em Lisboa",
      finalidade: "venda",
      hasStructured: true,
    });
    expect(r.kind).toBe("revisao");
    expect(r.reason).toMatch(/incoerente/i);
  });

  it("envia Arrendamento + Senhorio para revisão (oferta, não procura)", () => {
    const r = evaluateSearchAcceptance({
      text: "Tenho apartamento para arrendar em Lisboa, procuro inquilino",
      finalidade: "arrendamento",
      hasStructured: true,
    });
    expect(r.kind).toBe("revisao");
    expect(r.reason).toMatch(/senhorio|incoerente/i);
  });

  it("descarta anúncios claros independentemente da finalidade", () => {
    const r = evaluateSearchAcceptance({
      text: "Vende-se T3 remodelado, 250000€, agende visita",
      finalidade: "venda",
      hasStructured: true,
    });
    expect(r.kind).toBe("anuncio");
  });

  it("envia ambíguo sem estrutura para revisão", () => {
    const r = evaluateSearchAcceptance({
      text: "Boa tarde, alguém pode ajudar?",
      finalidade: "indefinido",
      hasStructured: false,
    });
    expect(r.kind).toBe("revisao");
  });
});
