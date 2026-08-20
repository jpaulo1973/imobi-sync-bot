import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { purgeExpiredSearches, type PurgeExpiredResult } from "@/lib/purge-expired.functions";

const FRASE = "APAGAR";

export function PurgeExpiredPanel() {
  const run = useServerFn(purgeExpiredSearches);
  const [res, setRes] = useState<PurgeExpiredResult | null>(null);
  const [busy, setBusy] = useState<"sim" | "apply" | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [texto, setTexto] = useState("");

  async function go(apply: boolean) {
    setBusy(apply ? "apply" : "sim");
    try {
      const r = await run({ data: { apply, dias: 0 } });
      setRes(r);
      if (apply) {
        setConfirmar(false);
        setTexto("");
        toast.success(`${r.apagadas} procuras apagadas definitivamente.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na limpeza.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-6 space-y-4 border-destructive/40">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Trash2 className="w-5 h-5 text-destructive" />
          Apagar procuras expiradas (Excel + WhatsApp)
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Apaga <strong>definitivamente</strong> as procuras de origem <code>excel</code> e{" "}
          <code>whatsapp</code> cujo <code>expires_at</code> já passou. Remove também as
          notificações, os estados e as oportunidades associadas.
        </p>
      </div>

      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        <strong>Irreversível:</strong> é um DELETE real — não há soft-delete, lixeira nem tabela de
        recuperação. Procuras de clientes do consultor nunca são afetadas.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => go(false)}>
          {busy === "sim" ? "A simular…" : "Simular"}
        </Button>
        {res && !res.aplicado && res.elegiveis > 0 && (
          confirmar ? (
            <>
              <Input
                className="w-40"
                placeholder={`Escreva ${FRASE}`}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />
              <Button
                variant="destructive"
                disabled={busy !== null || texto.trim().toUpperCase() !== FRASE}
                onClick={() => go(true)}
              >
                {busy === "apply" ? "A apagar…" : `Apagar ${res.elegiveis} definitivamente`}
              </Button>
              <Button variant="ghost" onClick={() => { setConfirmar(false); setTexto(""); }}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button variant="destructive" onClick={() => setConfirmar(true)}>
              Apagar definitivamente…
            </Button>
          )
        )}
      </div>

      {res && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="destructive">Elegíveis: {res.elegiveis}</Badge>
            {res.aplicado && <Badge>Apagadas: {res.apagadas}</Badge>}
            <Badge variant="outline">Oportunidades: {res.oportunidades_removidas}</Badge>
            <Badge variant="outline">Notificações: {res.notificacoes_removidas}</Badge>
            <Badge variant="outline">Estados: {res.estados_removidos}</Badge>
          </div>

          {res.por_origem.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {res.por_origem.map((o) => (
                <Badge key={o.origem} variant="secondary">
                  {o.origem}: {o.total}
                </Badge>
              ))}
            </div>
          )}

          {res.distribuicao.length > 0 && (
            <div>
              <p className="font-medium mb-1">Por mês de expiração</p>
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
                    <th className="py-1 pr-3">Origem</th>
                    <th className="py-1 pr-3">Publicação</th>
                    <th className="py-1">Expiração</th>
                  </tr>
                </thead>
                <tbody>
                  {res.amostra.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="py-1 pr-3">{a.nome ?? "—"}</td>
                      <td className="py-1 pr-3">{a.origem}</td>
                      <td className="py-1 pr-3">{a.publicacao ?? "—"}</td>
                      <td className="py-1 font-medium">{a.expiracao ?? "—"}</td>
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
