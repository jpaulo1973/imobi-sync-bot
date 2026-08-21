import { readFileSync } from "fs";
import { indexSnapshot } from "@/lib/geo/location-repository";
import { resolveRecordLocation, ancestorChain } from "@/lib/geo/geo-resolve-record";
import { classifyProperty, classifySearch, losesLevel, PERDA_NIVEL_EXCECOES } from "@/lib/geo/homonym-backfill";
import { scoreMatch, buildGeoMatchIndex, type BuyerLike } from "@/lib/matching-engine";

const J = (f: string) => JSON.parse(readFileSync(`/tmp/geodiag/${f}.json`, "utf8") || "[]");
const snap = indexSnapshot(99, J("loc"), J("ali"), J("rel"), J("fzm"));
const geoIndex = buildGeoMatchIndex(snap);
const info = (id: string | null) => (id ? snap.byId.get(id) : null);
const label = (id: string | null) => {
  const l = info(id);
  return l ? `${l.nome}[${l.tipo}]` : "—";
};
const labels = (ids: string[]) => (ids.length ? ids.map(label).join(", ") : "—");

function criteriaToBuyer(c: any, location_ids: string[] = []): BuyerLike {
  const finalidade = c?.finalidade === "indefinido" ? undefined : c?.finalidade;
  const cars = (c?.caracteristicas ?? []) as string[];
  return {
    finalidade,
    tipo_imovel: c?.tipo_imovel ?? null,
    tipologia: c?.tipologia ?? null,
    location_ids,
    budget_min: c?.budget_min ?? null,
    budget_max: c?.budget_max ?? null,
    area_min: c?.area_min ?? null,
    quartos_min: c?.quartos_min ?? null,
    garagem_obrigatoria: cars.some((x) => /garagem/i.test(x)),
    elevador_obrigatorio: cars.some((x) => /elevador/i.test(x)),
  } as BuyerLike;
}

const homonymConcelhos = new Set<string>();
for (const l of snap.locations) {
  if (l.tipo !== "concelho" || !l.parent_id) continue;
  const p = snap.byId.get(l.parent_id);
  if (p && p.nome.trim().toLowerCase() === l.nome.trim().toLowerCase()) homonymConcelhos.add(l.id);
}
const concOf = (id: string) => ancestorChain(id, snap).find((x) => info(x)?.tipo === "concelho") ?? null;

const EXCLUIR_PERDA_NIVEL = true;

// ---------- aplicar (em memória) ----------
const props = J("props_full") as any[];
const searches = J("searches_full") as any[];
const opps = J("opps") as any[];

const propBefore = new Map<string, string | null>();
const propAfter = new Map<string, string | null>();
let propChanged = 0;
const propTexto = new Map<string, string>();
for (const p of props) {
  propBefore.set(p.id, p.location_id ?? null);
  propTexto.set(p.id, [p.distrito, p.concelho, p.freguesia, p.zona].filter(Boolean).join(" / "));
  const res = resolveRecordLocation({ distrito: p.distrito, concelho: p.concelho, freguesia: p.freguesia, zona: p.zona }, snap);
  const cls = classifyProperty(p.location_id ?? null, res, snap);
  const excecao = PERDA_NIVEL_EXCECOES.has((p.referencia ?? "").trim());
  const perde = cls === "corrige" && !excecao && losesLevel(p.location_id ?? null, res.location_id, snap);
  if (cls === "corrige" && res.location_id && !(perde && EXCLUIR_PERDA_NIVEL)) {
    propAfter.set(p.id, res.location_id);
    propChanged++;
    if (excecao) console.log("EXCEÇÃO INCLUÍDA:", p.referencia, label(p.location_id), "→", label(res.location_id));
  } else {
    propAfter.set(p.id, p.location_id ?? null);
  }
}

const sBefore = new Map<string, string[]>();
const sAfter = new Map<string, string[]>();
const sTexto = new Map<string, string>();
let sChanged = 0;
for (const s of searches) {
  const c = s.criteria ?? {};
  const str = (v: any) => (typeof v === "string" ? v.trim() : "");
  sTexto.set(s.id, [str(c.distrito), str(c.municipio), str(c.freguesia), str(c.zona)].filter(Boolean).join(" / "));
  const cur: string[] = s.location_ids ?? [];
  sBefore.set(s.id, cur);
  const res = resolveRecordLocation({ distrito: str(c.distrito), concelho: str(c.municipio), freguesia: str(c.freguesia), zona: str(c.zona) }, snap);
  const cls = classifySearch(cur, res, snap);
  if (cls === "corrige" && res.location_ids.length > 0) {
    sAfter.set(s.id, res.location_ids);
    sChanged++;
  } else sAfter.set(s.id, cur);
}

// ---------- recompute ----------
function compute(pLoc: Map<string, string | null>, sLoc: Map<string, string[]>) {
  const set = new Set<string>();
  for (const s of searches) {
    const buyer = criteriaToBuyer(s.criteria, sLoc.get(s.id) ?? []);
    for (const p of props) {
      const prop = { ...p, location_id: pLoc.get(p.id) ?? null };
      const r = scoreMatch(buyer, prop as any, { geoIndex });
      if (!r.compatible || r.score < 60) continue;
      set.add(`${s.id}|${p.id}`);
    }
  }
  return set;
}

const before = compute(propBefore, sBefore);
const after = compute(propAfter, sAfter);
const vanish = [...before].filter((k) => !after.has(k));
const appear = [...after].filter((k) => !before.has(k));

console.log("\nimóveis alterados:", propChanged, "| procuras alteradas:", sChanged);
console.log("oportunidades antes:", before.size, "| depois:", after.size);
console.log("desaparecem:", vanish.length, "| aparecem:", appear.length);
console.log("(referência: match_opportunities em BD =", opps.length, ")");

const pById = new Map(props.map((p) => [p.id, p]));
const sById = new Map(searches.map((s) => [s.id, s]));

function motivo(sid: string, pid: string): string {
  const sb = sBefore.get(sid) ?? [];
  const sa = sAfter.get(sid) ?? [];
  const pb = propBefore.get(pid) ?? null;
  const pa = propAfter.get(pid) ?? null;
  const sChangedRow = JSON.stringify(sb) !== JSON.stringify(sa);
  const pChangedRow = pb !== pa;
  const removedHomonym = sb.some((id) => homonymConcelhos.has(id) && !sa.includes(id));
  if (sChangedRow && removedHomonym) return "concelho falso removido (homónimo distrito/concelho na procura)";
  if (sChangedRow && sa.length < sb.length) return "falso positivo de zona/freguesia fora de contexto removido na procura";
  if (sChangedRow) return "procura reancorada noutro concelho";
  if (pChangedRow && pb && homonymConcelhos.has(pb)) return "imóvel reancorado: concelho homónimo corrigido";
  if (pChangedRow) return "imóvel reancorado noutra localização";
  return "outro";
}

const amostra = vanish.slice(0, 10).map((k) => {
  const [sid, pid] = k.split("|");
  const p = pById.get(pid!)!;
  const s = sById.get(sid!)!;
  return {
    imovel: p.referencia ?? p.id,
    imovel_texto: propTexto.get(pid!) || "—",
    imovel_antes: label(propBefore.get(pid!) ?? null),
    imovel_depois: label(propAfter.get(pid!) ?? null),
    procura: s.contact_nome ?? s.consultor_nome ?? sid!.slice(0, 8),
    procura_texto: sTexto.get(sid!) || "—",
    procura_antes: labels(sBefore.get(sid!) ?? []),
    procura_depois: labels(sAfter.get(sid!) ?? []),
    motivo: motivo(sid!, pid!),
  };
});
console.log("\nAMOSTRA (10 de " + vanish.length + " desaparecidas):");
console.log(JSON.stringify(amostra, null, 1));

const porMotivo: Record<string, number> = {};
for (const k of vanish) {
  const [sid, pid] = k.split("|");
  const m = motivo(sid!, pid!);
  porMotivo[m] = (porMotivo[m] ?? 0) + 1;
}
console.log("\nDESAPARECEM por motivo:", porMotivo);
