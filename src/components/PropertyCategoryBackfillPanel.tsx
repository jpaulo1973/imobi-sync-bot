// Release 1.3.1 — Painel de backfill de categoria dos imóveis. Simulação
// obrigatória antes de aplicar.

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, PlayCircle, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import {
  runPropertyCategoryBackfill,
  type PropertyCategoryBackfillResult,
} from "@/lib/property-category-backfill.functions";
import { CATEGORY_LABELS } from "@/lib/property-taxonomy";

const DECISION_LABELS: Record<string, string> = {
  existente: "Já tinha categoria",
  tipo_imovel: "Derivada do tipo/subtipo",
  tipologia: "Inferida da tipologia",
  inferido_texto: "Inferida do texto",
  indecidivel: "Indecidível (fica em Revisão)",
};

function label(c: string | null): string {
  if (!c) return "—";
  return (CATEGORY_LABELS as Record<string, string>)[c] ?? c;
}

export function PropertyCategoryBackfillPanel() {
  const run = useServerFn(runPropertyCategoryBackfill);
  const [loading, setLoading] = useState<"dry" | "apply" | null>(null);
  const [result, setResult] = useState<PropertyCategoryBackfillResult | null>(null);

  async function exec(apply: boolean) {
    setLoading(apply ? "apply" : "dry");
    try {
      const res = await run({ data: { apply, sample: 40 } });
      setResult(res);
      toast.success(
        apply
          ? `Backfill aplicado: ${res.atualizados} imóveis atualizados.`
          : `Simulação: ${res.total_sem_categoria} imóveis sem categoria.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no backfill de categorias de imóveis");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" />
          Backfill de categoria dos imóveis
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Preenche a <strong>categoria</strong> de imóveis ativos que ficaram sem ela, usando
          tipo/subtipo, tipologia e palavras-chave do texto (sem IA). Imóveis sem categoria já não
          cruzam com procuras que exigem categoria — passam a pedir revisão em vez de dar match
          indevido. Nunca sobrepõe categorias existentes. Simula primeiro.
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
            <Badge variant="outline">{result.total_ativos} imóveis ativos</Badge>
            <Badge variant="outline">{result.total_sem_categoria} sem categoria</Badge>
            <Badge variant="secondary">{result.indecidiveis} indecidíveis</Badge>
            {result.applied && <Badge variant="outline">{result.atualizados} atualizados</Badge>}
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
                      <th className="text-left px-2 py-1">Imóvel</th>
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
                          <div className="font-medium">{s.referencia ?? "—"}</div>
                          <div className="text-muted-foreground">{s.zona ?? "—"}</div>
                          <div className="text-muted-foreground">{s.texto ?? ""}</div>
                        </td>
                        <td className="px-2 py-1">
                          {s.subtipo_imovel ?? s.tipo_imovel ?? "—"} / {s.tipologia ?? "—"}
                        </td>
                        <td className="px-2 py-1">{label(s.antes)}</td>
                        <td className="px-2 py-1">{label(s.depois)}</td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {DECISION_LABELS[s.decisao] ?? s.decisao}
                          {s.sinais.length > 1 && (
                            <div className="mt-1">
                              <Badge variant="secondary" className="text-[10px]">
                                Ambíguo: {s.sinais.map(label).join(", ")}
                              </Badge>
                            </div>
                          )}
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
