import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Check, X, ChevronDown, ChevronRight, Zap, Filter, ArrowUpDown } from "lucide-react";
import type { AuditCategoryResult, RejectReason, ShortCircuit } from "@/lib/matching-engine";
import { REJECT_REASON_LABELS } from "@/lib/matching-engine";

export type AuditRowData = {
  key: string;
  label: string;
  sourceLabel: string;
  compatible: boolean;
  score: number;
  rejectReason: RejectReason | null;
  shortCircuitAt: ShortCircuit | null;
  passedCount: number;
  failedCount: number;
  categories: AuditCategoryResult[];
  extraMeta?: string | null;
};

type StatusFilter = "todos" | "compat" | "rejeitados";
type SortMode = "compat_score_desc" | "score_desc" | "score_asc" | "rej_first";

const SORT_LABELS: Record<SortMode, string> = {
  compat_score_desc: "Compatíveis primeiro · Score ↓",
  score_desc: "Score (descendente)",
  score_asc: "Score (ascendente)",
  rej_first: "Rejeitados primeiro",
};

function pickCategoryValue(cats: AuditCategoryResult[], key: string): string | null {
  const c = cats.find((x) => x.key === key);
  if (!c) return null;
  return (c.expected || c.actual || null)?.toString() ?? null;
}

export function MatchAuditPanel({
  candidates,
  totals,
  emptyLabel = "Sem candidatos analisados.",
}: {
  candidates: AuditRowData[];
  totals: { total: number; compatible: number; rejected: number };
  emptyLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("todos");
  const [minScore, setMinScore] = useState<number>(0);
  const [finalidadeSel, setFinalidadeSel] = useState<string[]>([]);
  const [tipologiaSel, setTipologiaSel] = useState<string[]>([]);
  const [reasonSel, setReasonSel] = useState<RejectReason[]>([]);
  const [sort, setSort] = useState<SortMode>("compat_score_desc");

  // Facetas dinâmicas a partir do conjunto carregado.
  const facets = useMemo(() => {
    const fin = new Set<string>();
    const tip = new Set<string>();
    const rea = new Set<RejectReason>();
    for (const c of candidates) {
      const f = pickCategoryValue(c.categories, "finalidade");
      if (f) fin.add(f);
      const t = pickCategoryValue(c.categories, "tipologia");
      if (t) tip.add(t);
      if (!c.compatible && c.rejectReason) rea.add(c.rejectReason);
    }
    return {
      finalidades: Array.from(fin).sort(),
      tipologias: Array.from(tip).sort(),
      reasons: Array.from(rea).sort(),
    };
  }, [candidates]);

  const norm = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    const arr = candidates.filter((c) => {
      if (status === "compat" && !c.compatible) return false;
      if (status === "rejeitados" && c.compatible) return false;
      if (minScore > 0 && c.score < minScore) return false;
      if (finalidadeSel.length) {
        const f = pickCategoryValue(c.categories, "finalidade");
        if (!f || !finalidadeSel.includes(f)) return false;
      }
      if (tipologiaSel.length) {
        const t = pickCategoryValue(c.categories, "tipologia");
        if (!t || !tipologiaSel.includes(t)) return false;
      }
      if (reasonSel.length) {
        if (c.compatible || !c.rejectReason) return false;
        if (!reasonSel.includes(c.rejectReason)) return false;
      }
      if (!norm) return true;
      return (
        c.label.toLowerCase().includes(norm) ||
        c.sourceLabel.toLowerCase().includes(norm) ||
        (c.extraMeta ?? "").toLowerCase().includes(norm) ||
        c.categories.some(
          (cat) =>
            cat.label.toLowerCase().includes(norm) ||
            (cat.expected ?? "").toLowerCase().includes(norm) ||
            (cat.actual ?? "").toLowerCase().includes(norm),
        )
      );
    });
    arr.sort((a, b) => {
      switch (sort) {
        case "score_desc":
          return b.score - a.score;
        case "score_asc":
          return a.score - b.score;
        case "rej_first":
          if (a.compatible !== b.compatible) return a.compatible ? 1 : -1;
          return b.score - a.score;
        case "compat_score_desc":
        default:
          if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
          return b.score - a.score;
      }
    });
    return arr;
  }, [candidates, status, minScore, finalidadeSel, tipologiaSel, reasonSel, norm, sort]);

  const activeFilters =
    (status !== "todos" ? 1 : 0) +
    (minScore > 0 ? 1 : 0) +
    finalidadeSel.length +
    tipologiaSel.length +
    reasonSel.length;

  const clearAll = () => {
    setStatus("todos");
    setMinScore(0);
    setFinalidadeSel([]);
    setTipologiaSel([]);
    setReasonSel([]);
  };

  const toggleIn = <T,>(arr: T[], v: T, setter: (n: T[]) => void) => {
    setter(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{filtered.length}</span> de{" "}
          {totals.total} ·{" "}
          <span className="text-emerald-700">{totals.compatible} compatíveis</span> ·{" "}
          <span className="text-slate-600">{totals.rejected} rejeitados</span>
        </div>
        <div className="flex items-center gap-1">
          <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
            <SelectTrigger className="h-7 text-xs w-[220px]">
              <ArrowUpDown className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as SortMode[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {SORT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pesquisar (localização, referência, consultor, cliente, tipologia, finalidade…)"
          className="h-8 text-xs flex-1"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1">
              <Filter className="w-3.5 h-3.5" />
              Filtros
              {activeFilters > 0 && (
                <Badge className="ml-1 h-4 px-1 text-[10px]" variant="secondary">
                  {activeFilters}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3 space-y-3" align="end">
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Estado</p>
              <div className="flex items-center gap-1">
                {(["todos", "compat", "rejeitados"] as const).map((f) => (
                  <Button
                    key={f}
                    type="button"
                    variant={status === f ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs flex-1"
                    onClick={() => setStatus(f)}
                  >
                    {f === "todos" ? "Todos" : f === "compat" ? "Compatíveis" : "Rejeitados"}
                  </Button>
                ))}
              </div>
            </div>
            <Separator />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                  Score mínimo
                </p>
                <span className="text-xs tabular-nums">{minScore}%</span>
              </div>
              <Slider
                value={[minScore]}
                min={0}
                max={100}
                step={5}
                onValueChange={(v) => setMinScore(v[0] ?? 0)}
              />
            </div>
            {facets.finalidades.length > 0 && (
              <>
                <Separator />
                <FacetGroup
                  title="Finalidade"
                  options={facets.finalidades}
                  selected={finalidadeSel}
                  onToggle={(v) => toggleIn(finalidadeSel, v, setFinalidadeSel)}
                />
              </>
            )}
            {facets.tipologias.length > 0 && (
              <>
                <Separator />
                <FacetGroup
                  title="Tipologia"
                  options={facets.tipologias}
                  selected={tipologiaSel}
                  onToggle={(v) => toggleIn(tipologiaSel, v, setTipologiaSel)}
                />
              </>
            )}
            {facets.reasons.length > 0 && (
              <>
                <Separator />
                <FacetGroup
                  title="Regra que falhou"
                  options={facets.reasons}
                  labelFor={(v) => REJECT_REASON_LABELS[v as RejectReason]}
                  selected={reasonSel}
                  onToggle={(v) => toggleIn(reasonSel, v as RejectReason, setReasonSel)}
                />
              </>
            )}
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                {activeFilters} filtro{activeFilters === 1 ? "" : "s"} ativo{activeFilters === 1 ? "" : "s"}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={activeFilters === 0}
                onClick={clearAll}
              >
                Limpar
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <AuditRow key={c.key} row={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function FacetGroup({
  title,
  options,
  selected,
  onToggle,
  labelFor,
}: {
  title: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  labelFor?: (v: string) => string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <label
              key={opt}
              className={
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs cursor-pointer transition-colors " +
                (active ? "bg-primary/10 border-primary/40" : "bg-background hover:bg-muted")
              }
            >
              <Checkbox
                checked={active}
                onCheckedChange={() => onToggle(opt)}
                className="h-3.5 w-3.5"
              />
              <span>{labelFor ? labelFor(opt) : opt}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function AuditRow({ row }: { row: AuditRowData }) {
  const [open, setOpen] = useState(!row.compatible && row.passedCount + row.failedCount <= 12);
  return (
    <Card className="p-3 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2 text-left"
      >
        {open ? <ChevronDown className="w-4 h-4 mt-0.5" /> : <ChevronRight className="w-4 h-4 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {row.compatible ? (
              <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200">
                ✓ Compatível · {row.score}%
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-slate-50 text-slate-700">
                ✗ Rejeitado{row.rejectReason ? ` · ${REJECT_REASON_LABELS[row.rejectReason]}` : ""}
              </Badge>
            )}
            <span className="text-sm font-medium truncate">{row.label}</span>
            <Badge variant="outline" className="text-[10px]">{row.sourceLabel}</Badge>
            <span className="text-[11px] text-muted-foreground ml-auto">
              {row.passedCount} PASS · {row.failedCount} FAIL
            </span>
          </div>
          {row.extraMeta && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{row.extraMeta}</p>
          )}
          {row.shortCircuitAt && !row.compatible && (
            <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
              <Zap className="w-3 h-3" />
              Motor real parou em <strong className="mx-1">{row.shortCircuitAt.label}</strong> — {row.shortCircuitAt.detail}
            </p>
          )}
        </div>
      </button>
      {open && (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-2 py-1 w-6"></th>
                <th className="px-2 py-1">Filtro</th>
                <th className="px-2 py-1">Regra</th>
                <th className="px-2 py-1">Procura</th>
                <th className="px-2 py-1">Imóvel</th>
                <th className="px-2 py-1 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {row.categories.map((c, i) => {
                const isShort =
                  row.shortCircuitAt?.key === c.key && !c.ok;
                return (
                  <tr
                    key={`${c.key}-${i}`}
                    className={
                      "border-t " +
                      (c.ok ? "" : "bg-red-50/50 ") +
                      (isShort ? "ring-1 ring-amber-300" : "")
                    }
                  >
                    <td className="px-2 py-1 align-top">
                      {c.ok ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-red-600" />
                      )}
                    </td>
                    <td className="px-2 py-1 align-top font-medium whitespace-nowrap">{c.label}</td>
                    <td className="px-2 py-1 align-top text-muted-foreground">
                      {c.rule ?? c.detail}
                    </td>
                    <td className="px-2 py-1 align-top">{c.expected ?? "—"}</td>
                    <td className="px-2 py-1 align-top">{c.actual ?? "—"}</td>
                    <td className="px-2 py-1 align-top text-right tabular-nums">
                      {c.weight > 0 ? `${c.score}/${c.weight}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}