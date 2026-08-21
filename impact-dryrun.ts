// Dry-run de impacto no matching do backfill de homónimos (não escreve nada).
import { readFileSync } from "node:fs";
import { indexSnapshot } from "@/lib/geo/location-repository";
import { resolveRecordLocation, ancestorChain } from "@/lib/geo/geo-resolve-record";
import { classifyProperty, classifySearch } from "@/lib/geo/homonym-backfill";
import { buildGeoMatchIndex, scoreMatch } from "@/lib/matching-engine";
import { criteriaToBuyer } from "@/lib/property-match-counts";

const j = (f: string) => JSON.parse(readFileSync(`/tmp/impact/${f}.json`, "utf8") || "[]");
const locations = j("locations");
const snap = indexSnapshot(6, locations, j("aliases"), j("relations"), j("fzm"));
const geoIndex = buildGeoMatchIndex(snap);

const allProps = j("properties") as any[];
const allSearches = j("searches") as any[];
const now = Date.now();
const props = allProps.filter((p) => p.ativo);
const searches = allSearches.filter(
  (s) => s.descartado === false && new Date(s.expires_at).getTime() > now,
);

const nome = (id: string | null) => (id ? snap.byId.get(id)?.nome ?? "?" : "—");
const tipoOf = (id: string) => snap.byId.get(id)?.tipo;
const concelhoOf = (id: string | null): string | null => {
  if (!id) return null;
  for (const a of ancestorChain(id, snap)) if (tipoOf(a) === "concelho") return a;
  return null;
};

// ---------- Resolver propostas ----------
type PropPlan = { id: string; ref: string | null; from: string | null; to: string | null; classe: string; perde: boolean };
const propPlans: PropPlan[] = [];
for (const p of allProps) {
  const res = resolveRecordLocation(
    { distrito: p.distrito, concelho: p.concelho, freguesia: p.freguesia, zona: p.zona },
    snap,
  );
  const classe = classifyProperty(p.location_id ?? null, res, snap);
  const perde = Boolean(
    p.location_id && res.location_id && ancestorChain(p.location_id, snap).includes(res.location_id),
  );
  propPlans.push({ id: p.id, ref: p.referencia ?? null, from: p.location_id ?? null, to: res.location_id, classe, perde });
}

type SearchPlan = { id: string; from: string[]; to: string[]; classe: string };
const searchPlans: SearchPlan[] = [];
for (const s of allSearches) {
  const c = (s.criteria ?? {}) as any;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const res = resolveRecordLocation(
    { distrito: str(c.distrito), concelho: str(c.municipio), freguesia: str(c.freguesia), zona: str(c.zona) },
    snap,
  );
  const from = (s.location_ids ?? []) as string[];
  searchPlans.push({ id: s.id, from, to: res.location_ids, classe: classifySearch(from, res, snap) });
}

const propCorrige = propPlans.filter((p) => p.classe === "corrige");
const propCorrigeAplicar = propCorrige.filter((p) => !p.perde);
const propExcluidos = propCorrige.filter((p) => p.perde);
const searchCorrige = searchPlans.filter((s) => s.classe === "corrige");

console.log("=== PLANO ===");
console.log("imoveis corrige:", propCorrige.length, "| a aplicar:", propCorrigeAplicar.length, "| excluidos (perde granularidade):", propExcluidos.length);
for (const p of propExcluidos) console.log("  excluido:", p.ref, nome(p.from), "->", nome(p.to));
console.log("procuras corrige:", searchCorrige.length);

// ---------- Matching antes/depois ----------
const propNext = new Map(propCorrigeAplicar.map((p) => [p.id, p.to]));
const searchNext = new Map(searchCorrige.map((s) => [s.id, s.to]));

function computePairs(after: boolean): Map<string, number> {
  const out = new Map<string, number>();
  const effProps = props.map((p) => (after && propNext.has(p.id) ? { ...p, location_id: propNext.get(p.id) } : p));
  for (const s of searches) {
    const ids = after && searchNext.has(s.id) ? searchNext.get(s.id)! : ((s.location_ids ?? []) as string[]);
    const buyer = criteriaToBuyer(s.criteria, ids);
    for (const p of effProps) {
      const r = scoreMatch(buyer, p as any, { geoIndex });
      if (!r.compatible || r.score < 60) continue;
      out.set(`${s.id}|${p.id}`, r.score);
    }
  }
  return out;
}

const before = computePairs(false);
const after = computePairs(true);
let desaparecem = 0;
let aparecem = 0;
for (const k of before.keys()) if (!after.has(k)) desaparecem++;
for (const k of after.keys()) if (!before.has(k)) aparecem++;

console.log("\n=== IMPACTO MATCHING (universo: %d procuras ativas x %d imoveis) ===", searches.length, props.length);
console.log("oportunidades hoje (recalculadas):", before.size);
console.log("oportunidades depois:", after.size);
console.log("desaparecem:", desaparecem);
console.log("aparecem:", aparecem);
console.log("na tabela match_opportunities hoje:", (j("opps") as any[]).length);

// ---------- Padrões de substituição de concelho ----------
const pares = new Map<string, number>();
let semSubstituicao = 0;
for (const s of searchCorrige) {
  const oldC = [...new Set(s.from.map(concelhoOf).filter(Boolean))] as string[];
  const newC = [...new Set(s.to.map(concelhoOf).filter(Boolean))] as string[];
  const removed = oldC.filter((c) => !newC.includes(c));
  const added = newC.filter((c) => !oldC.includes(c));
  if (removed.length === 0 && added.length === 0) { semSubstituicao++; continue; }
  const key = `${removed.map(nome).join("+") || "(nenhum)"} -> ${added.map(nome).join("+") || "(removido)"}`;
  pares.set(key, (pares.get(key) ?? 0) + 1);
}
console.log("\n=== SUBSTITUICOES DE CONCELHO (procuras corrige) ===");
console.log("sem alteracao de concelho:", semSubstituicao);
for (const [k, v] of [...pares.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(4)}  ${k}`);
