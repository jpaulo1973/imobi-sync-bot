import { describe, expect, it } from "vitest";
import {
  MAX_PAYLOAD_BYTES,
  checkPayloadLimit,
  dataUrlBytes,
  decodedImageBytes,
  formatMb,
  scaleToMax,
  totalPayloadBytes,
} from "./image-compress";

describe("scaleToMax", () => {
  it("não amplia imagens pequenas", () => {
    expect(scaleToMax(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it("reduz o lado maior para 1600 mantendo o rácio", () => {
    expect(scaleToMax(4000, 2000)).toEqual({ width: 1600, height: 800 });
    expect(scaleToMax(2000, 4000)).toEqual({ width: 800, height: 1600 });
  });
  it("tolera dimensões inválidas", () => {
    expect(scaleToMax(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe("bytes", () => {
  it("conta bytes transportados e descodificados", () => {
    const url = "data:image/jpeg;base64,AAAA";
    expect(dataUrlBytes(url)).toBe(url.length);
    expect(decodedImageBytes(url)).toBe(3);
    expect(decodedImageBytes("sem-virgula")).toBe(0);
  });
  it("soma texto e imagens", () => {
    expect(totalPayloadBytes("abc", ["de", "f"])).toBe(6);
  });
  it("formata MB", () => {
    expect(formatMb(1024 * 1024)).toBe("1.0 MB");
  });
});

describe("checkPayloadLimit", () => {
  it("aceita lotes comprimidos típicos (5 posters ~350 KB)", () => {
    const imgs = Array.from({ length: 5 }, () => "data:image/jpeg;base64," + "A".repeat(350_000));
    const res = checkPayloadLimit("", imgs);
    expect(res.ok).toBe(true);
  });
  it("rejeita lotes acima do limite com mensagem clara", () => {
    const imgs = Array.from({ length: 5 }, () => "data:image/png;base64," + "A".repeat(7_000_000));
    const res = checkPayloadLimit("", imgs);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.bytes).toBeGreaterThan(MAX_PAYLOAD_BYTES);
      expect(res.message).toContain("acima do limite");
      expect(res.message).toContain("dois lotes");
    }
  });
});
