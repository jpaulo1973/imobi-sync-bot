import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  MapPin,
  Euro,
  Maximize,
  Trash2,
  Link2,
  Sparkles,
  Pencil,
  Target,
  Phone,
  Mail,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { importPropertyFromUrl } from "@/lib/properties.functions";
import { runPropertyMatch, countPropertyMatches } from "@/lib/property-match.functions";
import type { MatchCategoryResult } from "@/lib/matching-engine";

type Property = Tables<"properties">;
type BuyerClient = Tables<"buyer_clients">;
type MatchResult = {
  buyer: BuyerClient;
  score: number;
  reasons: string[];
  categories: MatchCategoryResult[];
};

export const Route = createFileRoute("/_authenticated/imoveis")({
  head: () => ({
    meta: [
      { title: "Imóveis — Property Match" },
      {
        name: "description",
        content:
          "Gestão do seu portefólio de imóveis angariados com Property Match automático para encontrar o comprador certo.",
      },
      { property: "og:title", content: "Imóveis — Property Match" },
      {
        property: "og:description",
        content: "Gestão do portefólio de imóveis angariados com Property Match automático.",
      },
      { property: "og:url", content: "https://imobi-sync-bot.lovable.app/imoveis" },
    ],
    links: [{ rel: "canonical", href: "https://imobi-sync-bot.lovable.app/imoveis" }],
  }),
  component: ImoveisPage,
});

const TIPO_OPTS = ["apartamento", "moradia", "terreno", "escritorio", "loja", "quinta", "garagem", "armazem", "outro"];
const TIPOS_SEM_TIPOLOGIA = ["terreno", "loja", "garagem", "armazem", "escritorio"];
const SUBTIPO_TERRENO_OPTS = [
  "urbano", "rustico", "urbanizavel", "misto", "construcao",
  "agricola", "industrial", "comercial", "florestal", "nao identificado",
];

// Extrai a parte numérica final da referência (ex.: "C0440-01025" → 1025).
// Usa BigInt-safe number: JS Number aguenta 2^53 — suficiente para refs de agência.
const refSortKey = (r: string | null | undefined): number => {
  if (!r) return Number.NEGATIVE_INFINITY;
  const matches = r.match(/\d+/g);
  if (!matches || matches.length === 0) return Number.NEGATIVE_INFINITY;
  const n = parseInt(matches[matches.length - 1], 10);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
};

type SortMode = "ref_desc" | "ref_asc" | "price_desc" | "price_asc" | "created_desc";
const SORT_LABELS: Record<SortMode, string> = {
  ref_desc: "Referência (mais recente)",
  ref_asc: "Referência (mais antiga)",
  price_desc: "Preço (↓)",
  price_asc: "Preço (↑)",
  created_desc: "Data de importação",
};

type FormState = {
  referencia: string;
  finalidade: "venda" | "arrendamento";
  tipo_imovel: string;
  subtipo_imovel: string;
  tipologia: string;
  preco: string;
  distrito: string;
  concelho: string;
  freguesia: string;
  zona: string;
  area_util_m2: string;
  garagem: boolean;
  elevador: boolean;
  jardim: boolean;
  piscina: boolean;
};

const empty: FormState = {
  referencia: "",
  finalidade: "venda",
  tipo_imovel: "apartamento",
  subtipo_imovel: "",
  tipologia: "T2",
  preco: "",
  distrito: "",
  concelho: "",
  freguesia: "",
  zona: "",
  area_util_m2: "",
  garagem: false,
  elevador: false,
  jardim: false,
  piscina: false,
};

const fromProperty = (p: Property): FormState => ({
  referencia: p.referencia ?? "",
  finalidade: (p.finalidade as "venda" | "arrendamento") ?? "venda",
  tipo_imovel: p.tipo_imovel ?? "apartamento",
  subtipo_imovel: p.subtipo_imovel ?? "",
  tipologia: p.tipologia ?? "",
  preco: p.preco != null ? String(p.preco) : "",
  distrito: p.distrito ?? "",
  concelho: p.concelho ?? "",
  freguesia: p.freguesia ?? "",
  zona: p.zona ?? "",
  area_util_m2: p.area_util_m2 != null ? String(p.area_util_m2) : "",
  garagem: p.garagem ?? false,
  elevador: p.elevador ?? false,
  jardim: p.jardim ?? false,
  piscina: p.piscina ?? false,
});

function ImoveisPage() {
  const importFn = useServerFn(importPropertyFromUrl);
  const matchFn = useServerFn(runPropertyMatch);
  const countsFn = useServerFn(countPropertyMatches);

  const [items, setItems] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortMode>("ref_desc");
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [missing, setMissing] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);

  const [matchOpen, setMatchOpen] = useState(false);
  const [matchProperty, setMatchProperty] = useState<Property | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [totalBuyers, setTotalBuyers] = useState(0);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("properties")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setItems(data ?? []);
    setLoading(false);
    // Contagens de compatíveis — não bloqueiam a UI
    countsFn({ data: undefined as unknown as never })
      .then((r) => setMatchCounts(r.counts ?? {}))
      .catch(() => {});
  };

  const sortedItems = useMemo(() => {
    const arr = [...items];
    const byCreatedDesc = (a: Property, b: Property) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    switch (sortBy) {
      case "ref_asc": {
        return arr.sort((a, b) => {
          const ka = refSortKey(a.referencia);
          const kb = refSortKey(b.referencia);
          // sem referência → sempre no fim
          if (!Number.isFinite(ka) && !Number.isFinite(kb)) return byCreatedDesc(a, b);
          if (!Number.isFinite(ka)) return 1;
          if (!Number.isFinite(kb)) return -1;
          if (ka !== kb) return ka - kb;
          return byCreatedDesc(a, b);
        });
      }
      case "price_asc":
        return arr.sort((a, b) => (Number(a.preco) || 0) - (Number(b.preco) || 0));
      case "price_desc":
        return arr.sort((a, b) => (Number(b.preco) || 0) - (Number(a.preco) || 0));
      case "created_desc":
        return arr.sort(byCreatedDesc);
      case "ref_desc":
      default: {
        return arr.sort((a, b) => {
          const ka = refSortKey(a.referencia);
          const kb = refSortKey(b.referencia);
          if (!Number.isFinite(ka) && !Number.isFinite(kb)) return byCreatedDesc(a, b);
          if (!Number.isFinite(ka)) return 1;
          if (!Number.isFinite(kb)) return -1;
          if (kb !== ka) return kb - ka;
          return byCreatedDesc(a, b);
        });
      }
    }
  }, [items, sortBy]);

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditingId(null);
    setForm(empty);
    setMissing([]);
    setDialogOpen(true);
  };

  const openEdit = (p: Property, missingFields: string[] = []) => {
    setEditingId(p.id);
    setForm(fromProperty(p));
    setMissing(missingFields);
    setDialogOpen(true);
  };

  const runMatch = async (p: Property) => {
    setMatchProperty(p);
    setMatchOpen(true);
    setMatchLoading(true);
    setMatches([]);
    try {
      const res = await matchFn({ data: { propertyId: p.id } });
      setMatches(res.matches);
      setTotalBuyers(res.totalBuyers);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao calcular Property Match");
    } finally {
      setMatchLoading(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();

    const tipo = form.tipo_imovel;
    const semTipologia = TIPOS_SEM_TIPOLOGIA.includes(tipo);
    const exigeTipologia = tipo === "apartamento" || tipo === "moradia";
    const exigeAreaUtil = tipo === "apartamento" || tipo === "moradia";
    const exigeAreaTerreno = tipo === "terreno" || tipo === "quinta";

    if (exigeTipologia && !form.tipologia.trim()) {
      toast.error("Tipologia é obrigatória para apartamentos e moradias.");
      return;
    }
    if ((exigeAreaUtil || exigeAreaTerreno) && !form.area_util_m2.trim()) {
      toast.error(exigeAreaTerreno ? "Área do terreno é obrigatória." : "Área útil é obrigatória.");
      return;
    }

    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) { setSaving(false); return; }

    const payload = {
      user_id: userData.user.id,
      referencia: form.referencia || null,
      finalidade: form.finalidade,
      tipo_imovel: form.tipo_imovel || null,
      subtipo_imovel: form.subtipo_imovel || null,
      tipologia: form.tipologia.trim() ? form.tipologia.trim() : semTipologia ? "N/D" : "N/D",
      preco: form.preco ? Number(form.preco) : 0,
      distrito: form.distrito || null,
      concelho: form.concelho || null,
      freguesia: form.freguesia || null,
      zona: form.zona || form.freguesia || form.concelho || "Por preencher",
      area_util_m2: form.area_util_m2 ? Number(form.area_util_m2) : null,
      area_m2: form.area_util_m2 ? Number(form.area_util_m2) : null,
      garagem: form.garagem,
      elevador: form.elevador,
      jardim: form.jardim,
      piscina: form.piscina,
    };

    let savedRow: Property | null = null;
    if (editingId) {
      const { data: upd, error } = await supabase
        .from("properties").update(payload).eq("id", editingId).select().single();
      if (error) { setSaving(false); toast.error(error.message); return; }
      savedRow = upd;
      toast.success("Imóvel atualizado");
    } else {
      const { data: ins, error } = await supabase
        .from("properties").insert(payload).select().single();
      if (error) { setSaving(false); toast.error(error.message); return; }
      savedRow = ins;
      toast.success("Imóvel adicionado");
    }

    setSaving(false);
    setDialogOpen(false);
    setForm(empty);
    setMissing([]);
    await load();
    if (savedRow) await runMatch(savedRow);
  };

  const remove = async (id: string) => {
    if (!confirm("Eliminar este imóvel?")) return;
    const { error } = await supabase.from("properties").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Eliminado"); load(); }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setImporting(true);
    try {
      const res = await importFn({ data: { url: url.trim() } });
      setUrl("");
      await load();
      if (res.missing_fields.length > 0) {
        toast.warning(`Importado. Faltam campos: ${res.missing_fields.join(", ")}. Complete para melhorar o Property Match.`);
        openEdit(res.property as Property, res.missing_fields);
      } else {
        toast.success("Imóvel importado");
        await runMatch(res.property as Property);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar");
    } finally {
      setImporting(false);
    }
  };

  const isMissing = (field: string) => missing.includes(field);
  const label = (text: string, field: string) => (
    <div className="flex items-center gap-2">
      <Label>{text}</Label>
      {isMissing(field) && (
        <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">em falta</Badge>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Imóveis angariados</h1>
          <p className="text-muted-foreground mt-1">
            {items.length} {items.length === 1 ? "imóvel" : "imóveis"} no seu portefólio · Property Match automático em cada criação
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortMode)}>
            <SelectTrigger className="w-[240px]" aria-label="Ordenar imóveis">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as SortMode[]).map((k) => (
                <SelectItem key={k} value={k}>{SORT_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" /> Adicionar imóvel</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar imóvel" : "Novo imóvel"}</DialogTitle>
              {missing.length > 0 && (
                <DialogDescription>
                  Alguns campos não foram importados automaticamente — preencha-os para um melhor Property Match.
                </DialogDescription>
              )}
            </DialogHeader>
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  {label("Referência", "referencia")}
                  <Input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} placeholder="REF-001" />
                </div>
                <div className="space-y-2">
                  <Label>Finalidade *</Label>
                  <Select value={form.finalidade} onValueChange={(v: "venda" | "arrendamento") => setForm({ ...form, finalidade: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="venda">Venda</SelectItem>
                      <SelectItem value="arrendamento">Arrendamento</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  {label("Tipo de imóvel", "tipo_imovel")}
                  <Select value={form.tipo_imovel} onValueChange={(v) => setForm({ ...form, tipo_imovel: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIPO_OPTS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  {label("Subtipo", "subtipo_imovel")}
                  {form.tipo_imovel === "terreno" ? (
                    <Select
                      value={form.subtipo_imovel || "nao identificado"}
                      onValueChange={(v) => setForm({ ...form, subtipo_imovel: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SUBTIPO_TERRENO_OPTS.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={form.subtipo_imovel}
                      onChange={(e) => setForm({ ...form, subtipo_imovel: e.target.value })}
                      placeholder="opcional (ex: duplex, geminada)"
                    />
                  )}
                </div>
                {TIPOS_SEM_TIPOLOGIA.includes(form.tipo_imovel) ? (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Tipologia</Label>
                    <div className="h-10 flex items-center px-3 rounded-md border border-dashed text-xs text-muted-foreground">
                      Não aplicável a {form.tipo_imovel} — guardado como N/D
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {label(
                      form.tipo_imovel === "apartamento" || form.tipo_imovel === "moradia"
                        ? "Tipologia *"
                        : "Tipologia",
                      "tipologia",
                    )}
                    <Input
                      value={form.tipologia}
                      onChange={(e) => setForm({ ...form, tipologia: e.target.value })}
                      placeholder="T2 / Moradia / N/D"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  {label("Preço (€) *", "preco")}
                  <Input type="number" value={form.preco} onChange={(e) => setForm({ ...form, preco: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  {label(
                    form.tipo_imovel === "terreno"
                      ? "Área do terreno (m²) *"
                      : form.tipo_imovel === "quinta"
                        ? "Área (m²) *"
                        : form.tipo_imovel === "apartamento" || form.tipo_imovel === "moradia"
                          ? "Área útil (m²) *"
                          : "Área (m²)",
                    "area_util_m2",
                  )}
                  <Input type="number" value={form.area_util_m2} onChange={(e) => setForm({ ...form, area_util_m2: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  {label("Distrito", "distrito")}
                  <Input value={form.distrito} onChange={(e) => setForm({ ...form, distrito: e.target.value })} placeholder="Lisboa" />
                </div>
                <div className="space-y-2">
                  {label("Concelho", "concelho")}
                  <Input value={form.concelho} onChange={(e) => setForm({ ...form, concelho: e.target.value })} placeholder="Cascais" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  {label("Freguesia", "freguesia")}
                  <Input value={form.freguesia} onChange={(e) => setForm({ ...form, freguesia: e.target.value })} placeholder="Carcavelos" />
                </div>
                <div className="space-y-2">
                  {label("Zona / bairro", "zona")}
                  <Input value={form.zona} onChange={(e) => setForm({ ...form, zona: e.target.value })} placeholder="opcional" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                {(["garagem", "elevador", "jardim", "piscina"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form[k]} onCheckedChange={(v) => setForm({ ...form, [k]: v === true })} />
                    <span className="capitalize">{k}</span>
                  </label>
                ))}
              </div>

              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "A guardar..." : editingId ? "Guardar alterações" : "Guardar e calcular Property Match"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h2 className="font-semibold">Importar por URL (Century 21, Idealista, Imovirtual…)</h2>
        </div>
        <form onSubmit={handleImport} className="flex gap-2">
          <Input
            placeholder="https://www.century21.pt/imovel/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={importing}
          />
          <Button type="submit" disabled={importing || !url.trim()}>
            <Link2 className="w-4 h-4 mr-2" />
            {importing ? "A importar..." : "Importar"}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-2">
          A importação é sempre parcial: se algum campo faltar, o imóvel é criado na mesma e pode completar manualmente.
        </p>
      </Card>

      {loading ? (
        <p className="text-muted-foreground">A carregar...</p>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">Ainda não tem imóveis. Adicione o primeiro para lançar o Property Match.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedItems.map((p) => (
            <Card key={p.id} className="p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <Badge variant={p.finalidade === "venda" ? "default" : "secondary"}>
                    {p.finalidade === "venda" ? "Venda" : "Arrendamento"}
                  </Badge>
                  {p.referencia && <span className="text-xs text-muted-foreground ml-2">{p.referencia}</span>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => runMatch(p)} title="Property Match" aria-label="Calcular Property Match">
                    <Target className="w-4 h-4 text-primary" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(p)} title="Editar" aria-label="Editar imóvel">
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(p.id)} title="Eliminar" aria-label="Eliminar imóvel">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-lg">
                  {p.tipologia && p.tipologia !== "N/D"
                    ? p.tipologia
                    : p.tipo_imovel
                      ? p.tipo_imovel.charAt(0).toUpperCase() + p.tipo_imovel.slice(1)
                      : "Imóvel"}
                  {p.tipo_imovel && p.tipologia && p.tipologia !== "N/D" && (
                    <span className="text-xs text-muted-foreground">
                      {" "}· {p.tipo_imovel}
                    </span>
                  )}
                  {p.subtipo_imovel && (
                    <span className="text-xs text-muted-foreground"> ({p.subtipo_imovel})</span>
                  )}
                </h3>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {[p.freguesia, p.concelho, p.distrito].filter(Boolean).join(", ") || p.zona}
                </p>
              </div>
              <div className="flex items-center gap-1 text-2xl font-bold text-primary">
                <Euro className="w-5 h-5" />
                {Number(p.preco).toLocaleString("pt-PT")}
                {p.finalidade === "arrendamento" && <span className="text-sm font-normal text-muted-foreground">/mês</span>}
              </div>
              <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                {p.area_util_m2 != null && (
                  <span className="inline-flex items-center gap-1"><Maximize className="w-4 h-4" /> {p.area_util_m2} m²</span>
                )}
                {p.garagem && <Badge variant="outline">garagem</Badge>}
                {p.elevador && <Badge variant="outline">elevador</Badge>}
                {p.jardim && <Badge variant="outline">jardim</Badge>}
                {p.piscina && <Badge variant="outline">piscina</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={matchOpen} onOpenChange={setMatchOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" />
              Property Match
            </DialogTitle>
            <DialogDescription>
              {matchProperty && <>
                Compradores compatíveis com <strong>{matchProperty.tipologia}</strong>
                {matchProperty.freguesia ? ` em ${matchProperty.freguesia}` : matchProperty.concelho ? ` em ${matchProperty.concelho}` : ""}.
              </>}
            </DialogDescription>
          </DialogHeader>

          {matchLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">A analisar compradores...</p>
          ) : matches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhum comprador compatível entre os {totalBuyers} clientes ativos.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {matches.length} compatíveis · ordenados por score
              </p>
              {matches.map((m, i) => {
                const tel = m.buyer.telefone?.replace(/\D/g, "");
                return (
                  <div key={m.buyer.id} className="p-3 rounded-lg border bg-secondary/40">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          <span className="text-primary">#{i + 1}</span>
                          {m.buyer.nome}
                          <Badge className="bg-accent text-accent-foreground">{m.score} pts</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{m.reasons.join(" · ") || "—"}</p>
                      </div>
                      <div className="flex gap-1">
                        {tel && (
                          <a href={`https://wa.me/${tel.startsWith("351") ? tel : "351" + tel}`} target="_blank" rel="noreferrer">
                            <Button variant="ghost" size="icon" title="WhatsApp"><MessageCircle className="w-4 h-4" /></Button>
                          </a>
                        )}
                        {m.buyer.telefone && (
                          <a href={`tel:${m.buyer.telefone}`}>
                            <Button variant="ghost" size="icon" title="Ligar"><Phone className="w-4 h-4" /></Button>
                          </a>
                        )}
                        {m.buyer.email && (
                          <a href={`mailto:${m.buyer.email}`}>
                            <Button variant="ghost" size="icon" title="Email"><Mail className="w-4 h-4" /></Button>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
