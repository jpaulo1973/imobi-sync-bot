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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Phone, Mail, MapPin, Euro } from "lucide-react";
import { toast } from "sonner";

type Buyer = Tables<"buyer_clients">;

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({ meta: [{ title: "Clientes — ImoMatch" }] }),
  component: ClientesPage,
});

const TIPOS_IMOVEL = [
  "Apartamento",
  "Moradia",
  "Espaço comercial",
  "Terreno",
  "Armazém",
  "Loja",
  "Escritório",
  "Prédio",
];

const empty = {
  nome: "",
  telefone: "",
  email: "",
  finalidade: "venda" as "venda" | "arrendamento",
  tipologia: "",
  zona: "",
  tipo_imovel: [] as string[],
  budget_min: "",
  budget_max: "",
  area_min: "",
  quartos_min: "",
  andar_min: "",
  garagem_obrigatoria: false,
  elevador_obrigatorio: false,
  notas: "",
};

function ClientesPage() {
  const [items, setItems] = useState<Buyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("buyer_clients")
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
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("buyer_clients").insert({
      user_id: u.user.id,
      nome: form.nome,
      telefone: form.telefone || null,
      email: form.email || null,
      finalidade: form.finalidade,
      tipologia: form.tipologia || null,
      zona: form.zona || null,
      tipo_imovel: form.tipo_imovel.length > 0 ? form.tipo_imovel : null,
      budget_min: form.budget_min ? Number(form.budget_min) : null,
      budget_max: form.budget_max ? Number(form.budget_max) : null,
      area_min: form.area_min ? Number(form.area_min) : null,
      quartos_min: form.quartos_min ? Number(form.quartos_min) : null,
      andar_min: form.andar_min ? Number(form.andar_min) : null,
      garagem_obrigatoria: form.garagem_obrigatoria,
      elevador_obrigatorio: form.elevador_obrigatorio,
      notas: form.notas || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Cliente adicionado");
    setOpen(false);
    setForm(empty);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Eliminar este cliente?")) return;
    const { error } = await supabase.from("buyer_clients").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Eliminado");
      load();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clientes compradores</h1>
          <p className="text-muted-foreground mt-1">
            {items.length} {items.length === 1 ? "cliente" : "clientes"} com critérios de procura
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" /> Adicionar cliente
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Novo cliente comprador</DialogTitle>
            </DialogHeader>
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Finalidade</Label>
                  <Select value={form.finalidade} onValueChange={(v: "venda" | "arrendamento") => setForm({ ...form, finalidade: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="venda">Comprar</SelectItem>
                      <SelectItem value="arrendamento">Arrendar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Tipo de imóvel (escolha vários)</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {TIPOS_IMOVEL.map((t) => (
                      <label key={t} className="inline-flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={form.tipo_imovel.includes(t)}
                          onCheckedChange={(v) => {
                            const next = v
                              ? [...form.tipo_imovel, t]
                              : form.tipo_imovel.filter((x) => x !== t);
                            setForm({ ...form, tipo_imovel: next });
                          }}
                        />
                        {t}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Tipologia</Label>
                  <Input value={form.tipologia} onChange={(e) => setForm({ ...form, tipologia: e.target.value })} placeholder="T2" />
                </div>
                <div className="space-y-2">
                  <Label>Zona / Localização</Label>
                  <Input value={form.zona} onChange={(e) => setForm({ ...form, zona: e.target.value })} placeholder="Cascais" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Budget mín (€)</Label>
                  <Input type="number" value={form.budget_min} onChange={(e) => setForm({ ...form, budget_min: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Budget máx (€)</Label>
                  <Input type="number" value={form.budget_max} onChange={(e) => setForm({ ...form, budget_max: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Área mín (m²)</Label>
                  <Input type="number" value={form.area_min} onChange={(e) => setForm({ ...form, area_min: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Quartos mín</Label>
                  <Input type="number" value={form.quartos_min} onChange={(e) => setForm({ ...form, quartos_min: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Andar mín</Label>
                  <Input type="number" value={form.andar_min} onChange={(e) => setForm({ ...form, andar_min: e.target.value })} />
                </div>
              </div>
              <div className="flex gap-6">
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={form.garagem_obrigatoria} onCheckedChange={(v) => setForm({ ...form, garagem_obrigatoria: !!v })} />
                  Garagem obrigatória
                </label>
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={form.elevador_obrigatorio} onCheckedChange={(v) => setForm({ ...form, elevador_obrigatorio: !!v })} />
                  Elevador obrigatório
                </label>
              </div>
              <div className="space-y-2">
                <Label>Notas</Label>
                <Textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} rows={3} />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "A guardar..." : "Guardar"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-muted-foreground">A carregar...</p>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">Ainda não tem clientes. Adicione o primeiro para começar a cruzar com anúncios dos portais.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((c) => (
            <Card key={c.id} className="p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{c.nome}</h3>
                  <Badge variant={c.finalidade === "venda" ? "default" : "secondary"} className="mt-1">
                    {c.finalidade === "venda" ? "Comprar" : "Arrendar"}
                  </Badge>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(c.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
              <div className="text-sm space-y-1 text-muted-foreground">
                {c.telefone && <p className="flex items-center gap-1"><Phone className="w-3 h-3" /> {c.telefone}</p>}
                {c.email && <p className="flex items-center gap-1"><Mail className="w-3 h-3" /> {c.email}</p>}
                {c.zona && <p className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {c.zona}</p>}
                {(c.budget_min || c.budget_max) && (
                  <p className="flex items-center gap-1">
                    <Euro className="w-3 h-3" />
                    {c.budget_min ? Number(c.budget_min).toLocaleString("pt-PT") : "0"} – {c.budget_max ? Number(c.budget_max).toLocaleString("pt-PT") : "∞"}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {c.tipologia && <Badge variant="outline">{c.tipologia}</Badge>}
                {c.tipo_imovel && <Badge variant="outline">{c.tipo_imovel}</Badge>}
                {c.area_min && <Badge variant="outline">≥{c.area_min}m²</Badge>}
                {c.quartos_min && <Badge variant="outline">≥{c.quartos_min} quartos</Badge>}
                {c.andar_min && <Badge variant="outline">≥{c.andar_min}º andar</Badge>}
                {c.garagem_obrigatoria && <Badge variant="outline">Garagem</Badge>}
                {c.elevador_obrigatorio && <Badge variant="outline">Elevador</Badge>}
              </div>
              {c.notas && <p className="text-xs text-muted-foreground line-clamp-2">{c.notas}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}