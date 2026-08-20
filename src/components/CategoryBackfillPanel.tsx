// Release 1.2.12 — Backfill de categorias das procuras. Simulação obrigatória
// antes de aplicar: mostra números por decisão e amostra antes/depois.

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tags, PlayCircle, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { runCategoryBackfill, type CategoryBackfillResult } from "@/lib/category-backfill.functions";
import { CATEGORY_LABELS } from "@/lib/property-taxonomy";

const DECISION_LABELS: Record<string, string> = {
  existente: "Já tinha categoria",
  tipo_imovel: "Derivada do tipo de imóvel",
  tipologia: "Inferida da tipologia",
  inferido_texto: "Inferida do texto original",
  indecidivel: "Indecidível (vai para Revisão)",
};

function cats(list: string[] | null | undefined): string {
  if (!list || list.length === 0) return "—";
  return list.map((c) => (CATEGORY_LABELS as Record<string, string>)[c] ?? c).join(", ");
}

export function CategoryBackfillPanel() {
  const run = useServerFn(runCategoryBackfill);
  const [loading, setLoading] = useState<"dry" | "apply" | null>(null);
  const [result, setResult] = useState<CategoryBackfillResult | null>(null);

  async function exec(apply: boolean) {
    setLoading(apply ? "apply" : "dry");
    try {
      const res = await run({ data: { apply, sample: 40 } });
      setResult(res);
      toast.success(
        apply
          ? `Backfill aplicado: ${res.atualizadas} procuras atualizadas.`
          : `Simulação: ${res.total_sem_categorias} procuras a atualizar.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no backfill de categorias");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Tags className="w-5 h-5 text-primary" />
          Backfill de categorias das procuras
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Preenche <strong>categorias</strong> em procuras que ficaram sem categoria decidida,
          usando o tipo de imóvel, a tipologia e palavras-chave do texto original (sem IA).
          Nunca sobrepõe categorias já existentes. Simula primeiro; só aplica depois de rever.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={loading !== null} onClick={() => exec(false)}>
          <FlaskConical className="w-4 h-4 mr-2" />
          {loading === "dry" ? "A simular…" : "Simular (não grava)"}
        </Button>
        <Button
          disabled={loading !== null || !result || result.applied}
          onClick={() => exec(true)}
          title={!result ? "Simule primeiro" : undefined}
        >
          <PlayCircle className="w-4 h-4 mr-2" />
          {loading === "apply" ? "A aplicar…" : "Aplicar backfill"}
        </Button>
      </div>

      {result && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">
              {result.applied ? "Backfill aplicado" : "Simulação (nada gravado)"}
            </span>
            <Badge variant="outline">{result.total_sem_categorias} procuras afetadas</Badge>
            {result.applied && <Badge variant="outline">{result.atualizadas} atualizadas</Badge>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Object.entries(result.por_origem).map(([k, v]) => (
              <div key={k} className="rounded border bg-background px-2 py-1">
                <div className="text-sm font-semibold tabular-nums">{v}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {DECISION_LABELS[k] ?? k}
                </div>
              </div>
            ))}
          </div>

          {result.amostra.length > 0 && (
            <div className="space-y-1">
              <div className="font-medium">Amostra antes/depois</div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto border rounded">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Procura</th>
                      <th className="text-left px-2 py-1">Tipo / Tipologia</th>
                      <th className="text-left px-2 py-1">Antes</th>
                      <th className="text-left px-2 py-1">Depois</th>
                      <th className="text-left px-2 py-1">Decisão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.amostra.map((s) => (
                      <tr key={s.id} className="border-t align-top">
                        <td className="px-2 py-1">
                          <div className="font-medium">{s.nome ?? "—"}</div>
                          <div className="text-muted-foreground">{s.texto ?? "—"}</div>
                        </td>
                        <td className="px-2 py-1">
                          {(s.tipo_imovel ?? []).join(", ") || "—"} / {s.tipologia ?? "—"}
                        </td>
                        <td className="px-2 py-1">{cats(s.antes)}</td>
                        <td className="px-2 py-1">{cats(s.depois)}</td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {DECISION_LABELS[s.decisao] ?? s.decisao}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
