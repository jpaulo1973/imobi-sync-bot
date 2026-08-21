// Comando 3/3 — Painel de backfill dos IDs geográficos errados por homónimos
// distrito/concelho. Simulação obrigatória antes de aplicar.

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MapPinned, PlayCircle, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import {
  backfillHomonymGeo,
  type HomonymBackfillResult,
} from "@/lib/homonym-geo-backfill.functions";

const CLASS_LABELS: Record<string, string> = {
  corrige: "Corrige (ID contradiz o texto)",
  especializa: "Especializa (nível mais fino)",
  mantem: "Mantém",
  conflito: "Conflito (revisão humana)",
};

export function HomonymGeoBackfillPanel() {
  const run = useServerFn(backfillHomonymGeo);
  const [loading, setLoading] = useState<"dry" | "apply" | null>(null);
  const [especializa, setEspecializa] = useState(false);
  const [result, setResult] = useState<HomonymBackfillResult | null>(null);

  async function exec(apply: boolean) {
    setLoading(apply ? "apply" : "dry");
    try {
      const res = await run({
        data: { apply, incluir_especializa: especializa, sample: 40 },
      });
      setResult(res);
      toast.success(
        apply
          ? `Aplicado: ${res.imoveis.atualizados} imóveis e ${res.procuras.atualizados} procuras atualizadas.`
          : `Simulação: ${res.imoveis.corrige} imóveis e ${res.procuras.corrige} procuras a corrigir.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no backfill de homónimos");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <MapPinned className="w-5 h-5 text-primary" />
          Backfill geográfico — homónimos distrito/concelho
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          18 concelhos têm o mesmo nome do distrito (Setúbal, Porto, Lisboa, Faro, Braga…). Registos
          antigos ficaram ancorados no concelho homónimo mesmo tendo concelho e freguesia em texto
          (ex.: concelho Grândola com ID do concelho Setúbal). Recalcula com o resolutor hierárquico
          e mostra o antes/depois. <strong>Aplicar</strong> grava apenas a classe{" "}
          <em>Corrige</em>; <em>Conflito</em> nunca é gravado.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="incluir-especializa"
          checked={especializa}
          disabled={loading !== null}
          onCheckedChange={setEspecializa}
        />
        <Label htmlFor="incluir-especializa" className="text-sm">
          Incluir também <em>Especializa</em> (torna o matching mais restrito) — desligado por
          omissão
        </Label>
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
          {loading === "apply" ? "A aplicar…" : "Aplicar correções"}
        </Button>
      </div>

      {result && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">
              {result.applied ? "Backfill aplicado" : "Simulação (nada gravado)"}
            </span>
            <Badge variant="outline">Biblioteca v{result.geo_library_version}</Badge>
            {result.incluir_especializa && <Badge variant="secondary">Especializa incluído</Badge>}
            {result.recompute && (
              <Badge variant="outline">
                Recompute: {result.recompute.procuras} procuras / {result.recompute.oportunidades}{" "}
                oportunidades
              </Badge>
            )}
          </div>

          {(["imoveis", "procuras"] as const).map((k) => (
            <div key={k} className="space-y-1">
              <div className="font-medium capitalize">
                {k === "imoveis" ? "Imóveis" : "Procuras"} — {result[k].total} analisados
                {result.applied ? ` · ${result[k].atualizados} atualizados` : ""}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(["corrige", "especializa", "conflito", "mantem"] as const).map((c) => (
                  <div key={c} className="rounded border bg-background px-2 py-1">
                    <div className="text-sm font-semibold tabular-nums">{result[k][c]}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {CLASS_LABELS[c]}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {result.amostra.length > 0 && (
            <div className="space-y-1">
              <div className="font-medium">Amostra antes/depois</div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto border rounded">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Registo</th>
                      <th className="text-left px-2 py-1">Texto</th>
                      <th className="text-left px-2 py-1">Antes</th>
                      <th className="text-left px-2 py-1">Depois</th>
                      <th className="text-left px-2 py-1">Classe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.amostra.map((s) => (
                      <tr key={`${s.tipo}-${s.id}`} className="border-t align-top">
                        <td className="px-2 py-1">
                          <div className="font-medium">{s.etiqueta ?? "—"}</div>
                          <div className="text-muted-foreground">
                            {s.tipo === "imovel" ? "Imóvel" : "Procura"}
                          </div>
                        </td>
                        <td className="px-2 py-1">{s.texto || "—"}</td>
                        <td className="px-2 py-1">{s.antes}</td>
                        <td className="px-2 py-1">{s.depois}</td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {CLASS_LABELS[s.classe] ?? s.classe}
                          {s.descartados && <div className="mt-1">{s.descartados}</div>}
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
