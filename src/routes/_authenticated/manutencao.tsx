import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Database, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { isCurrentUserAdmin } from "@/lib/admin.functions";
import {
  getMaintenanceStatus,
  setMaintenanceMode,
} from "@/lib/maintenance.functions";
import {
  backfillGeoFromText,
  recomputeAllMatches,
  type BackfillGeoResult,
  type RecomputeAllResult,
} from "@/lib/geo-backfill.functions";

export const Route = createFileRoute("/_authenticated/manutencao")({
  beforeLoad: async () => {
    const res = await isCurrentUserAdmin();
    if (!res.isAdmin) throw redirect({ to: "/imoveis" });
  },
  component: ManutencaoPage,
});

function ManutencaoPage() {
  const getFn = useServerFn(getMaintenanceStatus);
  const setFn = useServerFn(setMaintenanceMode);
  const backfillFn = useServerFn(backfillGeoFromText);
  const recomputeFn = useServerFn(recomputeAllMatches);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillGeoResult | null>(null);
  const [recomputeLoading, setRecomputeLoading] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState<RecomputeAllResult | null>(null);

  useEffect(() => {
    getFn()
      .then((s) => {
        setEnabled(s.enabled);
        setMessage(s.message ?? "");
        setLastUpdated(s.updated_at);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro"))
      .finally(() => setInitialLoad(false));
  }, [getFn]);

  const save = async (next: boolean) => {
    setLoading(true);
    try {
      const res = await setFn({
        data: { enabled: next, message: message.trim() || null },
      });
      setEnabled(res.enabled);
      setLastUpdated(new Date().toISOString());
      toast.success(
        next ? "Modo de manutenção activado" : "Modo de manutenção desactivado",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  };

  const runBackfill = async () => {
    setBackfillLoading(true);
    setBackfillResult(null);
    try {
      const res = await backfillFn();
      setBackfillResult(res);
      toast.success(
        `Backfill concluído — ${res.searches.resolved} procuras e ${res.properties.resolved} imóveis resolvidos.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no backfill");
    } finally {
      setBackfillLoading(false);
    }
  };

  const runRecompute = async () => {
    setRecomputeLoading(true);
    setRecomputeResult(null);
    try {
      const res = await recomputeFn();
      setRecomputeResult(res);
      toast.success(
        `Motor Match: ${res.searches_processed} procuras · ${res.opportunities_created} novos matches.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no recompute");
    } finally {
      setRecomputeLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          Modo de Manutenção
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bloqueia temporariamente o acesso a todos os utilizadores que não sejam administradores.
          Use durante publicações, migrações ou validações críticas.
        </p>
      </div>

      <Card className="p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-semibold flex items-center gap-2">
              Estado actual
              {enabled ? (
                <Badge className="bg-amber-100 text-amber-800 border-amber-200" variant="outline">
                  Manutenção activa
                </Badge>
              ) : (
                <Badge variant="outline">Operacional</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {lastUpdated
                ? `Última alteração: ${new Date(lastUpdated).toLocaleString("pt-PT")}`
                : "Sem alterações registadas."}
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={loading || initialLoad}
            onCheckedChange={(v) => save(!!v)}
            aria-label="Ligar/desligar modo de manutenção"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="msg">Mensagem para os utilizadores</Label>
          <Textarea
            id="msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ex.: Estamos a publicar melhorias. Voltamos em 5 minutos."
            rows={3}
            maxLength={500}
          />
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              Visível na página de manutenção. Máx. 500 caracteres.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => save(enabled)}
              disabled={loading || initialLoad}
            >
              Guardar mensagem
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <strong>Aviso:</strong> enquanto o modo estiver activo, os consultores verão uma página
          de manutenção em toda a aplicação. Os administradores continuam com acesso total.
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" />
            Sprint 1.2.2 — Recuperação Geográfica
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Reprocessa <strong>properties</strong> e <strong>active_searches</strong> convertendo
            texto livre (distrito, concelho, freguesia, zona) em IDs canónicos, usando exclusivamente
            o parser único do <code>LocationRepository</code>. Não duplica lógica geográfica em SQL.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={runBackfill}
            disabled={backfillLoading || recomputeLoading}
            variant="outline"
          >
            <Database className="w-4 h-4 mr-2" />
            {backfillLoading ? "A processar…" : "Executar backfill geográfico"}
          </Button>
          <Button
            onClick={runRecompute}
            disabled={backfillLoading || recomputeLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${recomputeLoading ? "animate-spin" : ""}`} />
            {recomputeLoading ? "A recalcular…" : "Reexecutar Motor Match"}
          </Button>
        </div>

        {backfillResult && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2">
            <div className="font-semibold">
              Backfill (v{backfillResult.geo_library_version})
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="font-medium">Imóveis</div>
                <div>Total sem location_id: {backfillResult.properties.total}</div>
                <div className="text-green-700">Resolvidos: {backfillResult.properties.resolved}</div>
                <div className="text-amber-700">Por resolver: {backfillResult.properties.unresolved}</div>
              </div>
              <div>
                <div className="font-medium">Procuras</div>
                <div>Total sem location_ids: {backfillResult.searches.total}</div>
                <div className="text-green-700">Resolvidas: {backfillResult.searches.resolved}</div>
                <div className="text-amber-700">Por resolver: {backfillResult.searches.unresolved}</div>
              </div>
            </div>
            {backfillResult.searches.top_unresolved.length > 0 && (
              <div>
                <div className="font-medium mt-2">Top zonas por interpretar (procuras)</div>
                <ul className="list-disc pl-4">
                  {backfillResult.searches.top_unresolved.slice(0, 10).map((t) => (
                    <li key={t.text}>
                      <code>{t.text}</code> — {t.count}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {recomputeResult && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="font-semibold mb-1">Motor Match</div>
            <div>Procuras processadas: {recomputeResult.searches_processed}</div>
            <div className="text-green-700">
              Novas oportunidades: {recomputeResult.opportunities_created}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}