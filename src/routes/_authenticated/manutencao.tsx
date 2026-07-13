import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { isCurrentUserAdmin } from "@/lib/admin.functions";
import {
  getMaintenanceStatus,
  setMaintenanceMode,
} from "@/lib/maintenance.functions";

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
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

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
    </div>
  );
}