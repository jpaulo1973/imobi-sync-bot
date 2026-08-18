import { describe, expect, it } from "vitest";
import { detectForeignLocation } from "./foreign-detect";

describe("detectForeignLocation", () => {
  it("deteta zonas dos Emirados", () => {
    for (const z of [
      "Damac Lagoons",
      "Palm Jebel Ali",
      "JVC, Arjan",
      "Sharjah, Emirados Árabes Unidos",
      "Bay Villas, Palm Jumeirah",
      "Expo City Dubai",
    ]) {
      expect(detectForeignLocation(z)?.country, z).toBe("Emirados Árabes Unidos");
    }
  });

  it("não sinaliza localizações portuguesas ambíguas", () => {
    for (const z of [
      "Marina de Lagos",
      "Encosta da Marina",
      "Sta. Marina / Afurada / Mafamude",
      "Cascais / Estoril",
      "Marinas, Portugal",
      "Palmela",
      "Vila Nova de Gaia",
      "Oeiras, Lisboa",
    ]) {
      expect(detectForeignLocation(z), z).toBeNull();
    }
  });

  it("ignora texto vazio", () => {
    expect(detectForeignLocation(null, undefined, "  ")).toBeNull();
  });

  it("deteta outros países", () => {
    expect(detectForeignLocation("Apartamento em Marbella")?.country).toBe("Espanha");
    expect(detectForeignLocation("Luanda, Talatona")?.country).toBe("Angola");
  });
});
