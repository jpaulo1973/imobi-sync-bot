import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Database, RefreshCw, LifeBuoy, CheckCheck } from "lucide-react";
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
import {
  listSupportRequests,
  markSupportRequestRead,
  replyToSupportRequest,
  resolveAndArchiveSupportRequest,
  reopenSupportRequest,
  type SupportRequest,
} from "@/lib/support.functions";
import { DuplicatesPanel } from "@/components/DuplicatesPanel";
import { ContactsBackfillPanel } from "@/components/ContactsBackfillPanel";
import { CategoryBackfillPanel } from "@/components/CategoryBackfillPanel";
import { PurgeExpiredPanel } from "@/components/PurgeExpiredPanel";
import {
  backfillContactsFromSearches,
  type ContactsBackfillResult,
} from "@/lib/contacts-backfill.functions";

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
  const supportListFn = useServerFn(listSupportRequests);
  const supportReadFn = useServerFn(markSupportRequestRead);
  const supportReplyFn = useServerFn(replyToSupportRequest);
  const supportResolveFn = useServerFn(resolveAndArchiveSupportRequest);
  const supportReopenFn = useServerFn(reopenSupportRequest);
  const [support, setSupport] = useState<SupportRequest[]>([]);
  const [supportUnread, setSupportUnread] = useState(0);
  const [supportArquivados, setSupportArquivados] = useState(false);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [replyBusy, setReplyBusy] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillGeoResult | null>(null);
  const [recomputeLoading, setRecomputeLoading] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState<RecomputeAllResult | null>(null);
  const contactsFn = useServerFn(backfillContactsFromSearches);
  const [contactsLoading, setContactsLoading] = useState<"dry" | "apply" | null>(null);
  const [contactsResult, setContactsResult] = useState<ContactsBackfillResult | null>(null);

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

  useEffect(() => {
    supportListFn({ data: { arquivados: supportArquivados } })
      .then((r) => {
        setSupport(r.items);
        setSupportUnread(r.unread);
      })
      .catch(() => {});
  }, [supportListFn, supportArquivados]);

  const reloadSupport = async () => {
    const r = await supportListFn({ data: { arquivados: supportArquivados } });
    setSupport(r.items);
    setSupportUnread(r.unread);
  };

  const sendReply = async (id: string) => {
    const texto = (replyDraft[id] ?? "").trim();
    if (texto.length < 2) {
      toast.error("Escreva uma resposta.");
      return;
    }
    setReplyBusy(id);
    try {
      await supportReplyFn({ data: { id, mensagem: texto } });
      setReplyDraft((p) => ({ ...p, [id]: "" }));
      await reloadSupport();
      toast.success("Resposta enviada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao responder");
    } finally {
      setReplyBusy(null);
    }
  };

  const resolveArchive = async (id: string) => {
    setReplyBusy(id);
    try {
      await supportResolveFn({ data: { id, arquivar: true } });
      await reloadSupport();
      toast.success("Marcado como resolvido e arquivado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setReplyBusy(null);
    }
  };

  const reopen = async (id: string) => {
    setReplyBusy(id);
    try {
      await supportReopenFn({ data: { id } });
      await reloadSupport();
      toast.success("Pedido reaberto.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setReplyBusy(null);
    }
  };

  const markRead = async (id: string) => {
    try {
      await supportReadFn({ data: { id } });
      setSupport((prev) =>
        prev.map((s) => (s.id === id ? { ...s, read_at: new Date().toISOString() } : s)),
      );
      setSupportUnread((n) => Math.max(0, n - 1));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

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

  const runContactsBackfill = async (dry: boolean) => {
    setContactsLoading(dry ? "dry" : "apply");
    try {
      const res = await contactsFn({ data: { dry_run: dry } });
      setContactsResult(res);
      toast.success(
        dry
          ? `Simulação: ${res.pares_elegiveis} pares elegíveis · ${res.nomes_ambiguos} nomes ambíguos excluídos.`
          : `${res.semeados} contactos semeados · ${res.reforcados} reforçados · ${res.nomes_ambiguos} nomes ambíguos por decidir.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no backfill de contactos");
    } finally {
      setContactsLoading(null);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {support.length > 0 && (
        <a
          href="#ajuda-sugestoes"
          className="flex items-center gap-2 rounded-md border p-3 text-sm hover:bg-secondary"
        >
          <LifeBuoy className="w-4 h-4 text-primary" />
          <span className="font-medium">Ajuda / Sugestões dos consultores</span>
          <Badge variant={supportUnread > 0 ? "default" : "outline"}>
            {supportUnread > 0 ? `${supportUnread} não lidas` : `${support.length} mensagens`}
          </Badge>
        </a>
      )}
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
                <div>Imóveis analisados: {backfillResult.properties.total}</div>
                <div>
                  Sem localização:{" "}
                  {backfillResult.properties.resolved + backfillResult.properties.unresolved}
                </div>
                <div className="text-green-700">Resolvidos: {backfillResult.properties.resolved}</div>
                <div className="text-amber-700">Por resolver: {backfillResult.properties.unresolved}</div>
              </div>
              <div>
                <div className="font-medium">Procuras</div>
                <div>Procuras analisadas: {backfillResult.searches.total}</div>
                <div>
                  Sem localização:{" "}
                  {backfillResult.searches.resolved + backfillResult.searches.unresolved}
                </div>
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

      <ContactsBackfillPanel
        result={contactsResult}
        loading={contactsLoading}
        onRun={runContactsBackfill}
      />

      <CategoryBackfillPanel />

      <Card id="ajuda-sugestoes" className="p-6 space-y-4 scroll-mt-20">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-primary" />
            Ajuda / Sugestões
            {supportUnread > 0 && <Badge variant="default">{supportUnread} não lidas</Badge>}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Mensagens enviadas pelos consultores através do botão “Ajuda / Sugestão”.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={supportArquivados ? "outline" : "default"}
            onClick={() => setSupportArquivados(false)}
          >
            Activos
          </Button>
          <Button
            size="sm"
            variant={supportArquivados ? "default" : "outline"}
            onClick={() => setSupportArquivados(true)}
          >
            Arquivados
          </Button>
        </div>
        {support.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem mensagens.</p>
        ) : (
          <div className="space-y-2">
            {support.map((s) => (
              <div
                key={s.id}
                className={`rounded-md border p-3 text-sm space-y-2 ${
                  s.read_at ? "" : "border-primary/40 bg-primary/5"
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-medium">
                    {s.autor_nome ?? s.autor_email ?? "Consultor"}
                    {s.autor_email && (
                      <span className="text-xs text-muted-foreground"> · {s.autor_email}</span>
                    )}
                    <Badge className="ml-2" variant={s.status === "resolvido" ? "outline" : "default"}>
                      {s.status === "resolvido" ? "Resolvido" : "Aberto"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(s.created_at).toLocaleString("pt-PT")}
                    </span>
                    {!s.read_at && (
                      <Button size="sm" variant="ghost" onClick={() => markRead(s.id)}>
                        <CheckCheck className="w-4 h-4 mr-1" /> Marcar lida
                      </Button>
                    )}
                  </div>
                </div>
                <p className="whitespace-pre-wrap break-words">{s.mensagem}</p>
                {(s.replies ?? []).length > 0 && (
                  <div className="space-y-1 border-l-2 pl-3">
                    {(s.replies ?? []).map((r) => (
                      <div key={r.id}>
                        <div className="text-xs text-muted-foreground">
                          Resposta · {new Date(r.created_at).toLocaleString("pt-PT")}
                        </div>
                        <p className="whitespace-pre-wrap break-words">{r.mensagem}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  <Textarea
                    rows={2}
                    placeholder="Escrever resposta ao consultor..."
                    value={replyDraft[s.id] ?? ""}
                    onChange={(e) =>
                      setReplyDraft((p) => ({ ...p, [s.id]: e.target.value }))
                    }
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" disabled={replyBusy === s.id} onClick={() => sendReply(s.id)}>
                      Responder
                    </Button>
                    {s.arquivado ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={replyBusy === s.id}
                        onClick={() => reopen(s.id)}
                      >
                        Reabrir
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={replyBusy === s.id}
                        onClick={() => resolveArchive(s.id)}
                      >
                        <CheckCheck className="w-4 h-4 mr-1" /> Marcar resolvido e arquivar
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <PurgeExpiredPanel />

      <DuplicatesPanel />
    </div>
  );
}