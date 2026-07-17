import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listPendingReview,
  updateReviewConsultor,
  deleteReviewSearch,
} from "@/lib/review.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/revisao")({
  head: () => ({
    meta: [
      { title: "Revisão — Property Match" },
      {
        name: "description",
        content:
          "Fila de exceções: casos novos que precisam de completar contactos do consultor.",
      },
    ],
  }),
  component: RevisaoPage,
});

type Item = Awaited<ReturnType<typeof listPendingReview>>["items"][number];

function RevisaoPage() {
  const listFn = useServerFn(listPendingReview);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    listFn()
      .then((r) => setItems(r.items as Item[]))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro"))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-lg bg-secondary text-primary inline-flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-3xl font-bold tracking-tight">Revisão</h1>
          <p className="text-muted-foreground mt-1">
            Fila de exceções. Apenas contactos do consultor são editáveis; todos os outros
            campos são resolvidos automaticamente pelo sistema.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : items.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">
          Sem casos pendentes de revisão.
        </Card>
      ) : (
        items.map((it) => <ConsultorCard key={it.id} item={it} onDone={reload} />)
      )}
    </div>
  );
}

function ConsultorCard({ item, onDone }: { item: Item; onDone: () => void }) {
  const updateFn = useServerFn(updateReviewConsultor);
  const deleteFn = useServerFn(deleteReviewSearch);
  const [nome, setNome] = useState((item as any).consultor_nome ?? "");
  const [telefone, setTelefone] = useState((item as any).consultor_telefone ?? "");
  const [whatsapp, setWhatsapp] = useState((item as any).consultor_whatsapp ?? "");
  const [email, setEmail] = useState((item as any).consultor_email ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateFn({
        data: {
          id: item.id,
          consultor_nome: nome.trim() || null,
          consultor_telefone: telefone.trim() || null,
          consultor_whatsapp: whatsapp.trim() || null,
          consultor_email: email.trim() || null,
          resolve: true,
        },
      });
      toast.success("Contactos guardados e caso reintegrado.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Eliminar esta procura?")) return;
    try {
      await deleteFn({ data: { id: item.id } });
      toast.success("Procura eliminada.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{item.origem.toUpperCase()}</Badge>
        {item.comunidade && <Badge variant="secondary">{item.comunidade}</Badge>}
        {item.grupo_whatsapp && <Badge variant="secondary">Grupo: {item.grupo_whatsapp}</Badge>}
        <span className="text-muted-foreground ml-auto">
          {new Date(item.created_at).toLocaleString("pt-PT")}
        </span>
      </div>

      {item.decision_reason && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          <strong>Motivo:</strong> {item.decision_reason}
        </p>
      )}

      {item.texto_original && (
        <div>
          <Label className="text-xs">Texto original (informativo)</Label>
          <p className="text-sm bg-muted/50 rounded p-2 whitespace-pre-wrap max-h-40 overflow-auto">
            {item.texto_original}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Nome do consultor</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" />
        </div>
        <div>
          <Label className="text-xs">Telefone</Label>
          <Input
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="+351 ..."
            inputMode="tel"
          />
        </div>
        <div>
          <Label className="text-xs">WhatsApp</Label>
          <Input
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="+351 ..."
            inputMode="tel"
          />
        </div>
        <div>
          <Label className="text-xs">Email (opcional)</Label>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="consultor@agencia.pt"
            inputMode="email"
            type="email"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <Button size="sm" onClick={save} disabled={saving}>
          <Save className="w-4 h-4 mr-1" />
          {saving ? "A guardar…" : "Guardar contactos e reintegrar"}
        </Button>
        <Button size="sm" variant="destructive" className="ml-auto" onClick={remove}>
          <Trash2 className="w-4 h-4 mr-1" /> Eliminar
        </Button>
      </div>
    </Card>
  );
}
