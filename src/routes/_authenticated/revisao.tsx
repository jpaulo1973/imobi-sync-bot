import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listConsultoresSemTelefone,
  setConsultorTelefone,
  type ConsultorSemTelefone,
} from "@/lib/review.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Phone, Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/revisao")({
  head: () => ({
    meta: [
      { title: "Revisão — Contactos sem telefone — Property Match" },
      {
        name: "description",
        content:
          "Consultores e contactos sem número de telefone válido. Corrija o número aqui e o registo sai automaticamente da lista.",
      },
    ],
  }),
  component: RevisaoPage,
});

function RevisaoPage() {
  const listFn = useServerFn(listConsultoresSemTelefone);
  const [items, setItems] = useState<ConsultorSemTelefone[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    listFn()
      .then((r) => setItems(r.consultores))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro"))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    reload();
  }, []);

  const removeLocal = (key: string) =>
    setItems((cur) => cur.filter((c) => c.key !== key));

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-lg bg-secondary text-primary inline-flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-3xl font-bold tracking-tight">Revisão — Contactos sem telefone</h1>
          <p className="text-muted-foreground mt-1">
            Consultores/contactos sem número de telefone válido. Introduza o
            número aqui: assim que for guardado, o registo sai desta lista.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : items.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">
          Sem contactos por corrigir. Todos os consultores têm telefone válido.
        </Card>
      ) : (
        items.map((it) => (
          <ContactoCard key={it.key} item={it} onSaved={() => removeLocal(it.key)} />
        ))
      )}
    </div>
  );
}

function ContactoCard({
  item,
  onSaved,
}: {
  item: ConsultorSemTelefone;
  onSaved: () => void;
}) {
  const saveFn = useServerFn(setConsultorTelefone);
  const [telefone, setTelefone] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const t = telefone.trim();
    if (!t) {
      toast.error("Introduza um número de telefone.");
      return;
    }
    setSaving(true);
    try {
      await saveFn({ data: { search_ids: item.search_ids, telefone: t } });
      toast.success(`Telefone guardado em ${item.procuras_afetadas} procura(s).`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">
          <Phone className="w-3 h-3 mr-1" /> Sem telefone
        </Badge>
        <span className="font-medium">{item.nome ?? "(sem nome)"}</span>
        {item.agency && <Badge variant="secondary">{item.agency}</Badge>}
        <span className="text-muted-foreground ml-auto">
          {item.procuras_afetadas} procura(s) afetada(s)
        </span>
      </div>

      {item.telefone_bruto && (
        <p className="text-xs text-muted-foreground">
          Valor atual: <span className="font-mono">{item.telefone_bruto}</span> (inválido)
        </p>
      )}

      <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-end">
        <div className="flex-1">
          <Label className="text-xs">Novo telefone</Label>
          <Input
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="+351 ..."
            inputMode="tel"
            autoComplete="tel"
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
        </div>
        <Button size="sm" onClick={save} disabled={saving}>
          <Save className="w-4 h-4 mr-1" />
          {saving ? "A guardar…" : "Guardar"}
        </Button>
      </div>

      {item.amostras[0]?.texto && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Ver contexto ({item.amostras.length})</summary>
          <div className="mt-2 space-y-2">
            {item.amostras.map((a) => (
              <div key={a.id} className="bg-muted/50 rounded p-2 whitespace-pre-wrap">
                {a.origem && <Badge variant="outline" className="mr-1">{a.origem}</Badge>}
                {a.texto?.slice(0, 240)}
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
