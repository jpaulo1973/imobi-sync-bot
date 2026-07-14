import { describe, expect, it } from "vitest";
import { groundLocationsInText } from "./search-splitter.server";

describe("groundLocationsInText", () => {
  it("keeps zonas that appear in the original text", () => {
    const r = groundLocationsInText(
      { finalidade: "venda", zona: "Almada", municipio: "Amora", freguesia: null },
      "Procuro moradia ate 500k Almada-Amora",
    );
    expect(r.zona).toBe("Almada");
    expect(r.municipio).toBe("Amora");
  });

  it("drops functional zone hallucinated by the LLM (Margem Sul from Almada-Amora)", () => {
    const r = groundLocationsInText(
      { finalidade: "venda", zona: "Margem Sul" },
      "Procuro moradia ate 500k Almada-Amora",
    );
    expect(r.zona).toBeNull();
  });

  it("keeps functional zone when it appears literally in the text", () => {
    const r = groundLocationsInText(
      { finalidade: "venda", zona: "Margem Sul" },
      "Procuro apartamento na Margem Sul até 300k",
    );
    expect(r.zona).toBe("Margem Sul");
  });

  it("is accent- and case-insensitive", () => {
    const r = groundLocationsInText(
      { finalidade: "venda", zona: "Azeitão" },
      "moradia em azeitao ate 400k",
    );
    expect(r.zona).toBe("Azeitão");
  });

  it("drops invented freguesia not present in text", () => {
    const r = groundLocationsInText(
      { finalidade: "venda", freguesia: "União das Freguesias de Azeitão" },
      "Procuro moradia em Amora até 500k",
    );
    expect(r.freguesia).toBeNull();
  });
});