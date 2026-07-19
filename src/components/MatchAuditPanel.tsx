import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, X, ChevronDown, ChevronRight, Zap } from "lucide-react";
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
  const [filter, setFilter] = useState<"todos" | "compat" | "rejeitados">("todos");
  const norm = q.trim().toLowerCase();
  const filtered = candidates.filter((c) => {
    if (filter === "compat" && !c.compatible) return false;
    if (filter === "rejeitados" && c.compatible) return false;
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{totals.total}</span> analisados ·{" "}
          <span className="text-emerald-700">{totals.compatible} compatíveis</span> ·{" "}
          <span className="text-slate-600">{totals.rejected} rejeitados</span>
        </div>
        <div className="flex items-center gap-1">
          {(["todos", "compat", "rejeitados"] as const).map((f) => (
            <Button
              key={f}
              type="button"
              variant={filter === f ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilter(f)}
            >
              {f === "todos" ? "Todos" : f === "compat" ? "Compatíveis" : "Rejeitados"}
            </Button>
          ))}
        </div>
      </div>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filtrar por nome, filtro, valor esperado/obtido…"
        className="h-8 text-xs"
      />
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