// B3/B4 — Painel do enriquecimento geográfico a partir do texto original.
// Simulação obrigatória antes de aplicar; divergências exportáveis em CSV.

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FileText, FlaskConical, PlayCircle, Download } from "lucide-react";
import { toast } from "sonner";
import {
  backfillGeoFromText,
  type GeoTextEnrichResult,
  type GeoEnrichSample,
} from "@/lib/geo-text-enrich-backfill.functions";

const CLASS_LABELS: Record<string, string> = {
  preenche: "Preenche (texto completa o que falta)",
  divergencia: "Divergência (revisão manual)",
  baixa_confianca: "Baixa confiança",
  sem_info: "Sem info no texto",
  mantem: "Mantém (já tem concelho/freguesia)",
};

function toCsv(rows: GeoEnrichSample[]): string {
  const head = ["id", "contacto", "classe", "confianca", "campos", "antes", "proposto", "motivo", "texto"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.id, r.etiqueta, r.classe, r.confianca, r.campos, r.antes, r.depois, r.motivo, r.texto]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

export function GeoTextEnrichPanel() {
  const run = useServerFn(backfillGeoFromText);
  const [loading, setLoading] = useState<"dry" | "apply" | null>(null);
  const [minConf, setMinConf] = useState(90);
  const [result, setResult] = useState<GeoTextEnrichResult | null>(null);

  async function exec(apply: boolean) {
    setLoading(apply ? "apply" : "dry");
    try {
      const res = await run({ data: { apply, min_confidence: minConf, sample: 40 } });
      setResult(res);
      toast.success(
        apply
          ? `Aplicado: ${res.atualizados} procuras enriquecidas.`
          : `Simulação: ${res.counts.preenche} a preencher, ${res.counts.divergencia} divergências.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no enriquecimento geográfico");
    } finally {
      setLoading(null);
    }
  }

  function exportCsv() {
    if (!result) return;
    const blob = new Blob([toCsv(result.divergencias)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `divergencias-geo-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          Enriquecimento geográfico a partir do texto original
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Procuras ancoradas só ao distrito (ou sem localização) ficam com amplitude excessiva e
          geram falsos positivos. Este backfill lê o texto original, resolve o concelho/freguesia em
          falta e só grava quando é coerente com o distrito já gravado e acima do limiar de
          confiança. <strong>Nunca sobrepõe</strong> um valor existente: conflitos vão para a lista
          de divergências para revisão manual.
        </p>
      </div>

      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="min-conf" className="text-sm">
            Confiança mínima para preencher
          </Label>
          <Input
            id="min-conf"
            type="number"
            min={50}
            max={100}
            className="w-28"
            value={minConf}
            disabled={loading !== null}
            onChange={(e) => setMinConf(Math.max(50, Math.min(100, Number(e.target.value) || 90)))}
          />
        </div>
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
          {loading === "apply" ? "A aplicar…" : "Aplicar enriquecimento"}
        </Button>
        {result && result.divergencias.length > 0 && (
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="w-4 h-4 mr-2" />
            Exportar divergências ({result.divergencias.length}) CSV
          </Button>
        )}
      </div>

      {result && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">
              {result.applied ? "Backfill aplicado" : "Simulação (nada gravado)"}
            </span>
            <Badge variant="outline">Biblioteca v{result.geo_library_version}</Badge>
            <Badge variant="outline">Limiar {result.min_confidence}</Badge>
            <Badge variant="outline">{result.total} procuras analisadas</Badge>
            {result.recompute && (
              <Badge variant="outline">
                Recompute: {result.recompute.procuras} procuras / {result.recompute.oportunidades}{" "}
                oportunidades
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(["preenche", "divergencia", "baixa_confianca", "sem_info", "mantem"] as const).map(
              (c) => (
                <div key={c} className="rounded border bg-background px-2 py-1">
                  <div className="text-sm font-semibold tabular-nums">{result.counts[c]}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {CLASS_LABELS[c]}
                  </div>
                </div>
              ),
            )}
          </div>

          {result.por_distrito.length > 0 && (
            <div className="space-y-1">
              <div className="font-medium">Por distrito</div>
              <div className="flex flex-wrap gap-1">
                {result.por_distrito.map((d) => (
                  <Badge key={d.distrito} variant="secondary">
                    {d.distrito}: {d.preenche} preenche / {d.divergencia} div.
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {result.amostra.length > 0 && (
            <div className="space-y-1">
              <div className="font-medium">Amostra</div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto border rounded">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Contacto</th>
                      <th className="text-left px-2 py-1">Texto original</th>
                      <th className="text-left px-2 py-1">Antes</th>
                      <th className="text-left px-2 py-1">Proposto</th>
                      <th className="text-left px-2 py-1">Classe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.amostra.map((s) => (
                      <tr key={s.id} className="border-t align-top">
                        <td className="px-2 py-1">
                          <div className="font-medium">{s.etiqueta ?? "—"}</div>
                          <div className="text-muted-foreground">{s.campos || "—"}</div>
                        </td>
                        <td className="px-2 py-1">{s.texto || "—"}</td>
                        <td className="px-2 py-1">{s.antes}</td>
                        <td className="px-2 py-1">{s.depois}</td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {CLASS_LABELS[s.classe] ?? s.classe}
                          {s.motivo && <div className="mt-1">{s.motivo}</div>}
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
