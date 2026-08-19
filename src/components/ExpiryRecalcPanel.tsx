import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { recalcExcelExpiry, type ExpiryRecalcResult } from "@/lib/expiry-recalc.functions";

export function ExpiryRecalcPanel() {
  const run = useServerFn(recalcExcelExpiry);
  const [res, setRes] = useState<ExpiryRecalcResult | null>(null);
  const [busy, setBusy] = useState<"sim" | "apply" | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  async function go(apply: boolean) {
    setBusy(apply ? "apply" : "sim");
    try {
      const r = await run({ data: { apply } });
      setRes(r);
      if (apply) {
        setConfirmar(false);
        toast.success(`Expiração recalculada em ${r.atualizadas} procuras.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no recálculo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Expiração das procuras Excel</h2>
        <p className="text-sm text-muted-foreground">
          Recalcula <code>expires_at</code> como <strong>data de publicação + 30 dias</strong> (em vez da data
          de importação). As procuras passam a expiradas — não são apagadas nem descartadas.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => go(false)}>
          {busy === "sim" ? "A simular…" : "Simular"}
        </Button>
        {res && !res.aplicado && res.afetadas > 0 && (
          confirmar ? (
            <>
              <Button variant="destructive" disabled={busy !== null} onClick={() => go(true)}>
                {busy === "apply" ? "A aplicar…" : `Confirmar: expirar ${res.ficam_expiradas} procuras`}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmar(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button onClick={() => setConfirmar(true)}>Aplicar…</Button>
          )
        )}
      </div>

      {res && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Afetadas: {res.afetadas}</Badge>
            <Badge variant="destructive">Ficam expiradas: {res.ficam_expiradas}</Badge>
            <Badge variant="outline">Sem data de publicação: {res.sem_base}</Badge>
            {res.aplicado && <Badge>Atualizadas: {res.atualizadas}</Badge>}
          </div>

          {res.distribuicao.length > 0 && (
            <div>
              <p className="font-medium mb-1">Por mês de publicação</p>
              <div className="flex flex-wrap gap-2">
                {res.distribuicao.map((d) => (
                  <Badge key={d.mes} variant="outline">
                    {d.mes}: {d.total}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {res.amostra.length > 0 && (
            <div className="overflow-x-auto">
              <p className="font-medium mb-1">Amostra (20 mais antigas)</p>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-3">Nome</th>
                    <th className="py-1 pr-3">Publicação</th>
                    <th className="py-1 pr-3">Expiração atual</th>
                    <th className="py-1">Nova expiração</th>
                  </tr>
                </thead>
                <tbody>
                  {res.amostra.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="py-1 pr-3">{a.nome ?? "—"}</td>
                      <td className="py-1 pr-3">{a.publicacao}</td>
                      <td className="py-1 pr-3">{a.exp_atual}</td>
                      <td className="py-1 font-medium">{a.exp_novo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
