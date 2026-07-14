import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { normalizeSearchBedrooms } from "./bedrooms-normalize";

// -----------------------------------------------------------------------------
// Guarda de arquitetura: garante que TODOS os canais de ingestão convergem
// para o mesmo resultado ao normalizar tipologia/quartos. Se um novo canal
// aparecer, deve importar `normalizeSearchBedrooms` — nunca reimplementar.
// -----------------------------------------------------------------------------

const INGESTION_FILES = [
  "src/lib/excel-import.functions.ts",
  "src/lib/whatsapp-leads.functions.ts",
  "src/lib/match.functions.ts",
];

describe("bedrooms-normalize — fonte única em todos os canais", () => {
  for (const f of INGESTION_FILES) {
    it(`${f} usa normalizeSearchBedrooms (ou re-exporta o módulo)`, () => {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src).toMatch(/from\s+["']\.\/bedrooms-normalize["']/);
    });

    it(`${f} não redefine parseTipologia/normalize com aritmética de dígitos`, () => {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      // Padrão problemático antigo: Number(tipologia.replace(/\D/g,"")) — que
      // convertia "T3" em 3, mas "73" em 73 (bug do Arrendamento).
      expect(src).not.toMatch(/Number\(\s*\w*[Tt]ipologia\w*\.replace\(\s*\/\\D\/g/);
    });
  }
});

describe("bedrooms-normalize — mesmo input → mesma decisão em qualquer canal", () => {
  const cases: Array<{ label: string; input: { tipologia?: unknown; quartos_min?: unknown }; tip: string | null; q: number | null }> = [
    { label: "Excel raw 'T3'", input: { tipologia: "T3" }, tip: "T3", q: 3 },
    { label: "Excel raw '3'", input: { tipologia: "3" }, tip: "T3", q: 3 },
    { label: "Excel raw 't3'", input: { tipologia: "t3" }, tip: "T3", q: 3 },
    { label: "Excel raw '3 quartos'", input: { tipologia: "3 quartos" }, tip: "T3", q: 3 },
    { label: "Excel raw 'T 3'", input: { tipologia: "T 3" }, tip: "T3", q: 3 },
    { label: "LLM WhatsApp {tipologia:'T3', quartos_min:3}", input: { tipologia: "T3", quartos_min: 3 }, tip: "T3", q: 3 },
    { label: "LLM extractAndMatch bug: tipologia='73'", input: { tipologia: "73", quartos_min: 73 }, tip: null, q: null },
    { label: "Multi 'T2 ou T3'", input: { tipologia: "T2 ou T3" }, tip: "T2 OU T3", q: 2 },
    { label: "Moradia", input: { tipologia: "Moradia" }, tip: "Moradia", q: null },
    { label: "Vazio", input: {}, tip: null, q: null },
  ];

  for (const c of cases) {
    it(`[${c.label}] → { ${c.tip}, ${c.q} } igual entre Excel / WhatsApp / extractAndMatch`, () => {
      const excel = normalizeSearchBedrooms(c.input, "excel");
      const whatsapp = normalizeSearchBedrooms(c.input, "whatsapp");
      const match = normalizeSearchBedrooms(c.input, "match");
      expect(excel).toEqual({ tipologia: c.tip, quartos_min: c.q });
      expect(whatsapp).toEqual(excel);
      expect(match).toEqual(excel);
    });
  }
});