import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Guarda estática Fase 3.
//
// A infraestrutura geográfica única (src/lib/geo/*) e o motor de matching
// não podem voltar a depender de estruturas textuais legadas nem de qualquer
// referência a `location-graph.ts` / `functional-zones.ts`. Se este teste
// falhar, é porque alguém reintroduziu comparações textuais no motor.
// ---------------------------------------------------------------------------

const ROOT = join(process.cwd(), "src");

const FORBIDDEN_SYMBOLS = [
  "KNOWN_CONCELHOS",
  "ADJACENT",
  "areFreguesiasAdjacent",
  "isKnownConcelho",
  "isKnownFreguesia",
  "location-graph",
  "functional-zones",
  "resolveZone",
  "loadZoneContext",
  "coverageIncludesProperty",
  "ZoneResolverContext",
];

// `normalizeLocation` só é permitido dentro de src/lib/geo/ (nome antigo
// reservado a helpers internos). No motor e nos callers, usa-se
// `normalizeGeoText`.
const RESTRICTED_TO_GEO = ["normalizeLocation"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"))
      out.push(p);
  }
  return out;
}

describe("geo static guard (Fase 3)", () => {
  const files = walk(ROOT);

  it("nenhum ficheiro de produção importa location-graph ou functional-zones", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const sym of FORBIDDEN_SYMBOLS) {
        if (src.includes(sym)) offenders.push(`${f}: contém "${sym}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("normalizeLocation só vive dentro de src/lib/geo/", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.includes(`${"/"}lib${"/"}geo${"/"}`)) continue;
      const src = readFileSync(f, "utf8");
      for (const sym of RESTRICTED_TO_GEO) {
        if (src.includes(sym)) offenders.push(`${f}: contém "${sym}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});