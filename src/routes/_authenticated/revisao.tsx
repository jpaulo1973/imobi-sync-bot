import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listPendingReview,
  updateReviewSearch,
  deleteReviewSearch,
  splitReviewSearch,
  recruzarTudo,
  listUnknownZones,
  createFunctionalZoneFromReview,
  ignoreUnknownZone,
  listIncompleteConsultores,
  type IncompleteConsultor,
} from "@/lib/review.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Save, Split, Trash2, Plus, X, RefreshCw, MapPin, UserX } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { LocationSelector } from "@/components/entity-selector/LocationSelector";

export const Route = createFileRoute("/_authenticated/revisao")({
  head: () => ({
    meta: [
      { title: "Revisão — Property Match" },
      { name: "description", content: "Caixa de entrada de exceções: procuras que precisam de revisão manual." },
    ],
  }),
  component: RevisaoPage,
});

type Item = Awaited<ReturnType<typeof listPendingReview>>["items"][number];

type CriteriaForm = {
  finalidade: "venda" | "arrendamento" | "indefinido";
  tipo_imovel: string;
  tipologia: string;
  zona: string;
  location_ids: string[];
  budget_min: string;
  budget_max: string;
  area_min: string;
  quartos_min: string;
  caracteristicas: string;
};

function criteriaToForm(c: any, location_ids: string[] = []): CriteriaForm {
  return {
    finalidade: (c?.finalidade ?? "indefinido") as any,
    tipo_imovel: Array.isArray(c?.tipo_imovel) ? c.tipo_imovel.join(", ") : "",
    tipologia: c?.tipologia ?? "",
    zona: c?.zona ?? c?.municipio ?? c?.freguesia ?? "",
    location_ids: [...location_ids],
    budget_min: c?.budget_min != null ? String(c.budget_min) : "",
    budget_max: c?.budget_max != null ? String(c.budget_max) : "",
    area_min: c?.area_min != null ? String(c.area_min) : "",
    quartos_min: c?.quartos_min != null ? String(c.quartos_min) : "",
    caracteristicas: Array.isArray(c?.caracteristicas) ? c.caracteristicas.join(", ") : "",
  };
}

function formToCriteria(f: CriteriaForm) {
  const arr = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  return {
    finalidade: f.finalidade,
    tipo_imovel: f.tipo_imovel.trim() ? arr(f.tipo_imovel) : null,
    tipologia: f.tipologia.trim() || null,
    zona: f.zona.trim() || null,
    budget_min: num(f.budget_min),
    budget_max: num(f.budget_max),
    area_min: num(f.area_min),
    quartos_min: num(f.quartos_min),
    caracteristicas: f.caracteristicas.trim() ? arr(f.caracteristicas) : null,
  };
}

function RevisaoPage() {
  const listFn = useServerFn(listPendingReview);
  const recruzarFn = useServerFn(recruzarTudo);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [recruzando, setRecruzando] = useState(false);

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

  const runRecruzar = async () => {
    setRecruzando(true);
    try {
      const r = await recruzarFn();
      toast.success(
        `Recruzamento concluído: ${r.duplicados_removidos} duplicado(s) removido(s), ${r.oportunidades_purgadas} oportunidade(s) obsoleta(s) purgada(s).`,
      );
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no recruzamento");
    } finally {
      setRecruzando(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-lg bg-secondary text-primary inline-flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-3xl font-bold tracking-tight">Revisão</h1>
          <p className="text-muted-foreground mt-1">
            Caixa de entrada de exceções. Procuras sinalizadas pelo sistema como ambíguas que
            precisam de intervenção humana.
          </p>
        </div>
        <Button variant="outline" onClick={runRecruzar} disabled={recruzando}>
          <RefreshCw className={"w-4 h-4 mr-2 " + (recruzando ? "animate-spin" : "")} />
          {recruzando ? "A recruzar…" : "Recruzar tudo"}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : items.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">
          Não existem procuras pendentes de revisão.
        </Card>
      ) : (
        items.map((it) => <ReviewCard key={it.id} item={it} onDone={reload} />)
      )}

      <UnknownZonesPanel />
      <IncompleteConsultoresPanel />
    </div>
  );
}

function IncompleteConsultoresPanel() {
  const listFn = useServerFn(listIncompleteConsultores);
  const [items, setItems] = useState<IncompleteConsultor[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listFn()
      .then((r) => setItems(r.consultores))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro"))
      .finally(() => setLoading(false));
  }, [listFn]);

  const labelFor = (m: IncompleteConsultor["missing"][number]) =>
    m === "nome" ? "Sem nome" : m === "telefone" ? "Sem telefone" : m === "email" ? "Sem email" : "Sem agência";

  return (
    <section className="space-y-3 pt-6 border-t">
      <div className="flex items-center gap-2">
        <UserX className="w-4 h-4 text-primary" />
        <h2 className="text-lg font-semibold">Consultores por Completar</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Consultores identificados em procuras ativas mas com dados essenciais em falta
        (nome, telemóvel, email ou agência). Completar o perfil destes consultores antes
        de disponibilizar oportunidades entre consultores.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : items.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground text-center">
          Todos os consultores em uso têm contactos completos.
        </Card>
      ) : (
        items.map((c) => (
          <Card key={c.key} className="p-3 flex flex-wrap items-center gap-3">
            <Badge variant="outline">{c.procuras_afetadas}×</Badge>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{c.nome ?? "— sem nome —"}</p>
              <p className="text-xs text-muted-foreground truncate">
                {c.telefone ?? "sem telefone"}
                {c.email ? ` · ${c.email}` : ""}
                {c.agency ? ` · ${c.agency}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {c.missing.map((m) => (
                <Badge key={m} variant="destructive" className="text-xs">
                  {labelFor(m)}
                </Badge>
              ))}
            </div>
          </Card>
        ))
      )}
    </section>
  );
}

function UnknownZonesPanel() {
  const listFn = useServerFn(listUnknownZones);
  const createFn = useServerFn(createFunctionalZoneFromReview);
  const ignoreFn = useServerFn(ignoreUnknownZone);
  const [zones, setZones] = useState<
    Array<{ key: string; expression: string; count: number; search_ids: string[]; samples: string[] }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [openFor, setOpenFor] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    listFn()
      .then((r) => setZones(r.zones as any))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro"))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onIgnore = async (search_ids: string[]) => {
    try {
      await ignoreFn({ data: { search_ids } });
      toast.success("Expressão ignorada.");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <section className="space-y-3 pt-6 border-t">
      <div className="flex items-center gap-2">
        <MapPin className="w-4 h-4 text-primary" />
        <h2 className="text-lg font-semibold">Zonas por Aprovar</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Expressões de localização que o motor não reconheceu. Aprovar como zona funcional
        permite reutilizá-las em todas as procuras futuras.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : zones.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground text-center">
          Sem zonas por aprovar.
        </Card>
      ) : (
        zones.map((z) => (
          <Card key={z.key} className="p-3 flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="uppercase">{z.count}×</Badge>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{z.expression}</p>
              {z.samples[0] && (
                <p className="text-xs text-muted-foreground truncate">"{z.samples[0]}"</p>
              )}
            </div>
            <Button size="sm" onClick={() => setOpenFor(z.key)}>
              <Plus className="w-4 h-4 mr-1" /> Criar Zona Funcional
            </Button>
            <Button size="sm" variant="outline" onClick={() => onIgnore(z.search_ids)}>
              Ignorar
            </Button>
            <CreateZoneDialog
              open={openFor === z.key}
              onClose={() => setOpenFor(null)}
              expression={z.expression}
              searchIds={z.search_ids}
              onCreated={reload}
              createFn={createFn}
            />
          </Card>
        ))
      )}
    </section>
  );
}

function CreateZoneDialog({
  open,
  onClose,
  expression,
  searchIds,
  onCreated,
  createFn,
}: {
  open: boolean;
  onClose: () => void;
  expression: string;
  searchIds: string[];
  onCreated: () => void;
  createFn: (args: any) => Promise<any>;
}) {
  const [nome, setNome] = useState(expression);
  const [aliases, setAliases] = useState(expression);
  const [freguesias, setFreguesias] = useState("");
  const [municipios, setMunicipios] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNome(expression);
    setAliases(expression);
  }, [expression]);

  const save = async () => {
    if (!nome.trim()) {
      toast.error("Indique um nome.");
      return;
    }
    const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    setSaving(true);
    try {
      const r = await createFn({
        data: {
          nome: nome.trim(),
          aliases: split(aliases),
          coverage: {
            freguesias: split(freguesias),
            municipios: split(municipios),
          },
          search_ids: searchIds,
        },
      });
      toast.success(`Zona "${r.nome}" criada. ${r.recomputed} procura(s) recruzada(s).`);
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Criar Zona Funcional</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Aliases (separados por vírgula)</Label>
            <Input value={aliases} onChange={(e) => setAliases(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Freguesias cobertas (separadas por vírgula)</Label>
            <Textarea value={freguesias} onChange={(e) => setFreguesias(e.target.value)} rows={2} />
          </div>
          <div>
            <Label className="text-xs">Concelhos cobertos (separados por vírgula)</Label>
            <Textarea value={municipios} onChange={(e) => setMunicipios(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "A criar…" : "Criar Zona"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewCard({ item, onDone }: { item: Item; onDone: () => void }) {
  const updateFn = useServerFn(updateReviewSearch);
  const deleteFn = useServerFn(deleteReviewSearch);
  const splitFn = useServerFn(splitReviewSearch);

  const [forms, setForms] = useState<CriteriaForm[]>(() => [criteriaToForm(item.criteria)]);
  const [saving, setSaving] = useState(false);

  const isSplit = forms.length > 1;
  const badgeLabel = useMemo(() => item.origem.toUpperCase(), [item.origem]);

  const update = (idx: number, patch: Partial<CriteriaForm>) =>
    setForms((cur) => cur.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  const save = async () => {
    setSaving(true);
    try {
      if (isSplit) {
        await splitFn({
          data: { id: item.id, parts: forms.map((f) => formToCriteria(f)) as any },
        });
        toast.success(`Procura dividida em ${forms.length} registos.`);
      } else {
        await updateFn({
          data: { id: item.id, criteria: formToCriteria(forms[0]) as any, resolve: true },
        });
        toast.success("Procura atualizada e reintegrada.");
      }
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
        <Badge variant="outline">{badgeLabel}</Badge>
        {item.consultor_nome && <Badge variant="secondary">Consultor: {item.consultor_nome}</Badge>}
        {item.comunidade && <Badge variant="secondary">Comunidade: {item.comunidade}</Badge>}
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
          <Label className="text-xs">Texto original</Label>
          <p className="text-sm bg-muted/50 rounded p-2 whitespace-pre-wrap">{item.texto_original}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div><span className="text-muted-foreground">Nome:</span> {item.contact_nome ?? "—"}</div>
        <div><span className="text-muted-foreground">Telefone:</span> {item.contact_telefone ?? "—"}</div>
      </div>

      {forms.map((f, idx) => (
        <div key={idx} className="border rounded-md p-3 space-y-3 relative">
          {isSplit && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Procura #{idx + 1}</span>
              {forms.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setForms((cur) => cur.filter((_, i) => i !== idx))}
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Finalidade</Label>
              <select
                className="w-full h-9 border rounded-md px-2 text-sm bg-background"
                value={f.finalidade}
                onChange={(e) => update(idx, { finalidade: e.target.value as any })}
              >
                <option value="indefinido">Indefinido</option>
                <option value="venda">Venda</option>
                <option value="arrendamento">Arrendamento</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Tipo de imóvel</Label>
              <Input value={f.tipo_imovel} onChange={(e) => update(idx, { tipo_imovel: e.target.value })} placeholder="Moradia, Apartamento" />
            </div>
            <div>
              <Label className="text-xs">Tipologia</Label>
              <Input value={f.tipologia} onChange={(e) => update(idx, { tipologia: e.target.value })} placeholder="T2" />
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs">Localização</Label>
              <Input value={f.zona} onChange={(e) => update(idx, { zona: e.target.value })} placeholder="Cascais" />
            </div>
            <div>
              <Label className="text-xs">Preço mín (€)</Label>
              <Input value={f.budget_min} onChange={(e) => update(idx, { budget_min: e.target.value })} inputMode="numeric" />
            </div>
            <div>
              <Label className="text-xs">Preço máx (€)</Label>
              <Input value={f.budget_max} onChange={(e) => update(idx, { budget_max: e.target.value })} inputMode="numeric" />
            </div>
            <div>
              <Label className="text-xs">Quartos mín</Label>
              <Input value={f.quartos_min} onChange={(e) => update(idx, { quartos_min: e.target.value })} inputMode="numeric" />
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs">Características</Label>
              <Textarea value={f.caracteristicas} onChange={(e) => update(idx, { caracteristicas: e.target.value })} rows={2} placeholder="garagem, elevador, jardim" />
            </div>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <Button size="sm" onClick={save} disabled={saving}>
          <Save className="w-4 h-4 mr-1" /> {isSplit ? "Guardar divisão" : "Guardar e reintegrar"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setForms((cur) => [...cur, criteriaToForm(item.criteria)])}
        >
          <Split className="w-4 h-4 mr-1" /> <Plus className="w-3 h-3" /> Dividir em nova procura
        </Button>
        <Button size="sm" variant="destructive" className="ml-auto" onClick={remove}>
          <Trash2 className="w-4 h-4 mr-1" /> Eliminar
        </Button>
      </div>
    </Card>
  );
}