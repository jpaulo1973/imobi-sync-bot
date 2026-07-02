import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, MapPin, Euro, Bed, Maximize, Trash2, Link2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { importPropertyFromUrl } from "@/lib/properties.functions";

type Property = Tables<"properties">;

export const Route = createFileRoute("/_authenticated/imoveis")({
  head: () => ({ meta: [{ title: "Imóveis — ImoMatch" }] }),
  component: ImoveisPage,
});

const empty = {
  referencia: "",
  finalidade: "venda" as "venda" | "arrendamento",
  tipologia: "T2",
  zona: "",
  concelho: "",
  preco: "",
  area_m2: "",
  quartos: "",
  casas_banho: "",
  descricao: "",
  caracteristicas: "",
};

function ImoveisPage() {
  const importFn = useServerFn(importPropertyFromUrl);
  const [items, setItems] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("properties")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setItems(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error } = await supabase.from("properties").insert({
      user_id: userData.user.id,
      referencia: form.referencia || null,
      finalidade: form.finalidade,
      tipologia: form.tipologia,
      zona: form.zona,
      concelho: form.concelho || null,
      preco: Number(form.preco),
      area_m2: form.area_m2 ? Number(form.area_m2) : null,
      quartos: form.quartos ? Number(form.quartos) : null,
      casas_banho: form.casas_banho ? Number(form.casas_banho) : null,
      descricao: form.descricao || null,
      caracteristicas: form.caracteristicas || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Imóvel adicionado");
    setOpen(false);
    setForm(empty);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Eliminar este imóvel?")) return;
    const { error } = await supabase.from("properties").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Eliminado");
      load();
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setImporting(true);
    try {
      await importFn({ data: { url: url.trim() } });
      toast.success("Imóvel importado");
      setUrl("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Imóveis angariados</h1>
          <p className="text-muted-foreground mt-1">
            {items.length} {items.length === 1 ? "imóvel" : "imóveis"} no seu portefólio
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" /> Adicionar imóvel
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Novo imóvel</DialogTitle>
            </DialogHeader>
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Referência</Label>
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
                  <Label>Tipologia *</Label>
                  <Input value={form.tipologia} onChange={(e) => setForm({ ...form, tipologia: e.target.value })} placeholder="T2 / Moradia" required />
                </div>
                <div className="space-y-2">
                  <Label>Preço (€) *</Label>
                  <Input type="number" value={form.preco} onChange={(e) => setForm({ ...form, preco: e.target.value })} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Zona *</Label>
                  <Input value={form.zona} onChange={(e) => setForm({ ...form, zona: e.target.value })} placeholder="Cascais" required />
                </div>
                <div className="space-y-2">
                  <Label>Concelho</Label>
                  <Input value={form.concelho} onChange={(e) => setForm({ ...form, concelho: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Área (m²)</Label>
                  <Input type="number" value={form.area_m2} onChange={(e) => setForm({ ...form, area_m2: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Quartos</Label>
                  <Input type="number" value={form.quartos} onChange={(e) => setForm({ ...form, quartos: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>WCs</Label>
                  <Input type="number" value={form.casas_banho} onChange={(e) => setForm({ ...form, casas_banho: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={3} />
              </div>
              <div className="space-y-2">
                <Label>Características</Label>
                <Input value={form.caracteristicas} onChange={(e) => setForm({ ...form, caracteristicas: e.target.value })} placeholder="garagem, varanda, vista mar" />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "A guardar..." : "Guardar"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h2 className="font-semibold">Importar por URL</h2>
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
          Cole o link do anúncio (Century 21, Idealista, Imovirtual, etc.) e a IA extrai automaticamente os dados.
        </p>
      </Card>

      {loading ? (
        <p className="text-muted-foreground">A carregar...</p>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground mb-4">
            Ainda não tem imóveis. Adicione o primeiro para começar a cruzar com leads.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((p) => (
            <Card key={p.id} className="p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <Badge variant={p.finalidade === "venda" ? "default" : "secondary"}>
                    {p.finalidade === "venda" ? "Venda" : "Arrendamento"}
                  </Badge>
                  {p.referencia && (
                    <span className="text-xs text-muted-foreground ml-2">{p.referencia}</span>
                  )}
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(p.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
              <div>
                <h3 className="font-semibold text-lg">{p.tipologia}</h3>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {p.zona}{p.concelho ? `, ${p.concelho}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 text-2xl font-bold text-primary">
                <Euro className="w-5 h-5" />
                {Number(p.preco).toLocaleString("pt-PT")}
                {p.finalidade === "arrendamento" && <span className="text-sm font-normal text-muted-foreground">/mês</span>}
              </div>
              <div className="flex gap-4 text-sm text-muted-foreground">
                {p.quartos != null && (
                  <span className="inline-flex items-center gap-1"><Bed className="w-4 h-4" /> {p.quartos}</span>
                )}
                {p.area_m2 != null && (
                  <span className="inline-flex items-center gap-1"><Maximize className="w-4 h-4" /> {p.area_m2} m²</span>
                )}
              </div>
              {p.descricao && <p className="text-sm text-muted-foreground line-clamp-2">{p.descricao}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
