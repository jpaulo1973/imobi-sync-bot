import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  analyzeWhatsappConversations,
  createBuyersFromLeads,
  type QualifiedLead,
} from "@/lib/whatsapp-leads.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, MessageSquare, ImagePlus, X, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/cruzar")({
  head: () => ({
    meta: [
      { title: "Importar Conversas WhatsApp — Property Match" },
      {
        name: "description",
        content:
          "Importa capturas de conversas WhatsApp e cria automaticamente leads qualificadas para o Property Match.",
      },
      { property: "og:title", content: "Importar Conversas WhatsApp — Property Match" },
      {
        property: "og:description",
        content: "Transforma capturas de WhatsApp em leads qualificadas no Property Match.",
      },
      { property: "og:url", content: "https://imobi-sync-bot.lovable.app/cruzar" },
    ],
    links: [{ rel: "canonical", href: "https://imobi-sync-bot.lovable.app/cruzar" }],
  }),
  component: CruzarPage,
});

type EditableLead = QualifiedLead & {
  _selected: boolean;
  _telefone?: string;
  _email?: string;
};

const MAX_IMGS = 20;

function confidenceStyle(c: QualifiedLead["confianca"]) {
  if (c === "alta") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (c === "media") return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-rose-100 text-rose-800 border-rose-200";
}

function CruzarPage() {
  const [texto, setTexto] = useState("");
  const [imagens, setImagens] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [leads, setLeads] = useState<EditableLead[] | null>(null);
  const [totalCapturas, setTotalCapturas] = useState<number>(0);
  const analyze = useServerFn(analyzeWhatsappConversations);
  const create = useServerFn(createBuyersFromLeads);
  const fileRef = useRef<HTMLInputElement>(null);

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) return;
    const remaining = MAX_IMGS - imagens.length;
    if (remaining <= 0) return toast.error(`Máximo ${MAX_IMGS} imagens.`);
    try {
      const urls = await Promise.all(arr.slice(0, remaining).map(fileToDataUrl));
      setImagens((prev) => [...prev, ...urls]);
    } catch {
      toast.error("Erro a ler imagem.");
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f && f.type.startsWith("image/")) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const submit = async () => {
    if (texto.trim().length < 10 && imagens.length === 0) {
      return toast.error("Cole texto ou adicione pelo menos uma captura de ecrã.");
    }
    setLoading(true);
    setLeads(null);
    try {
      const res = await analyze({ data: { texto, imagens } });
      setTotalCapturas(res.total_capturas ?? imagens.length);
      const editable: EditableLead[] = (res.leads ?? []).map((l) => ({
        ...l,
        _selected: l.confianca !== "baixa",
      }));
      setLeads(editable);
      if (editable.length === 0) toast.info("Nenhuma lead identificada nas conversas.");
      else toast.success(`${editable.length} lead(s) identificada(s)`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      if (msg.includes("CREDITS_EXHAUSTED")) toast.error("Créditos de IA esgotados.");
      else if (msg.includes("RATE_LIMITED")) toast.error("Demasiados pedidos, tenta novamente em breve.");
      else toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const updateLead = (i: number, patch: Partial<EditableLead>) => {
    setLeads((prev) => (prev ? prev.map((l, j) => (i === j ? { ...l, ...patch } : l)) : prev));
  };
  const removeLead = (i: number) =>
    setLeads((prev) => (prev ? prev.filter((_, j) => j !== i) : prev));

  const confirmCreate = async () => {
    if (!leads) return;
    const chosen = leads.filter((l) => l._selected);
    if (chosen.length === 0) return toast.error("Seleciona pelo menos uma lead para criar.");
    setCreating(true);
    try {
      const res = await create({
        data: {
          leads: chosen.map((l) => ({
            nome: l.nome ?? null,
            finalidade: l.finalidade,
            tipo_imovel: l.tipo_imovel ?? null,
            tipologia: l.tipologia ?? null,
            zona: l.zona ?? null,
            budget_min: l.budget_min ?? null,
            budget_max: l.budget_max ?? null,
            area_min: l.area_min ?? null,
            quartos_min: l.quartos_min ?? null,
            caracteristicas: l.caracteristicas ?? null,
            contacto: l.contacto ?? null,
            resumo: l.resumo,
            mensagem_original: l.mensagem_original ?? null,
            confianca: l.confianca,
            telefone: l._telefone ?? null,
            email: l._email ?? null,
          })),
        },
      });
      toast.success(`${res.inserted} lead(s) criada(s) e disponíveis no Property Match.`);
      setLeads(null);
      setTexto("");
      setImagens([]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar leads.");
    } finally {
      setCreating(false);
    }
  };

  const selectedCount = leads?.filter((l) => l._selected).length ?? 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Importar Conversas WhatsApp</h1>
        <p className="text-muted-foreground mt-1">
          Carrega capturas de ecrã dos grupos de WhatsApp. A IA lê como um consultor e cria
          automaticamente leads qualificadas prontas para o Property Match.
        </p>
      </div>

      <Card className="p-6 space-y-4" onPaste={onPaste}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-secondary text-primary inline-flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-semibold">Conversas a analisar</h2>
            <p className="text-sm text-muted-foreground">
              Adiciona várias capturas da mesma conversa — serão agrupadas antes da análise. Podes
              também colar texto adicional.
            </p>
          </div>
        </div>

        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          placeholder="(Opcional) Cola aqui texto de conversas WhatsApp..."
          className="font-mono text-sm"
        />

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {imagens.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {imagens.map((src, i) => (
              <div key={i} className="relative group border rounded-md overflow-hidden bg-muted">
                <img src={src} alt={`captura ${i + 1}`} className="w-full h-24 object-cover" />
                <span className="absolute bottom-1 left-1 text-[10px] px-1 rounded bg-background/80 border">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setImagens((p) => p.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 p-1 rounded-full bg-background/90 border shadow-sm opacity-0 group-hover:opacity-100 transition"
                  aria-label="Remover"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={loading || imagens.length >= MAX_IMGS}
          >
            <ImagePlus className="w-4 h-4 mr-2" />
            Importar Conversas WhatsApp {imagens.length > 0 && `(${imagens.length}/${MAX_IMGS})`}
          </Button>
          <Button onClick={submit} disabled={loading} size="lg" className="w-full sm:w-auto">
            <Sparkles className="w-4 h-4 mr-2" />
            {loading ? "A analisar conversas..." : "Analisar conversas"}
          </Button>
        </div>
      </Card>

      {leads && (
        <div className="space-y-4">
          <Card className="p-4 flex items-center justify-between flex-wrap gap-3">
            <div className="text-sm">
              Foram analisadas <strong>{totalCapturas}</strong> captura(s). Identificadas{" "}
              <strong>{leads.length}</strong> potenciais lead(s).
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {selectedCount} selecionada(s)
              </span>
              <Button
                onClick={confirmCreate}
                disabled={creating || selectedCount === 0}
                size="sm"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                {creating ? "A criar..." : `Criar ${selectedCount} lead(s)`}
              </Button>
            </div>
          </Card>

          {leads.length === 0 && (
            <Card className="p-6 text-center text-muted-foreground">
              Não foram identificadas leads. Tenta carregar mais capturas ou colar mais contexto.
            </Card>
          )}

          {leads.map((lead, i) => (
            <Card key={i} className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="checkbox"
                    checked={lead._selected}
                    onChange={(e) => updateLead(i, { _selected: e.target.checked })}
                    className="w-4 h-4"
                    aria-label="Selecionar lead"
                  />
                  <Badge variant="outline" className={confidenceStyle(lead.confianca)}>
                    Confiança {lead.confianca}
                  </Badge>
                  <Badge variant={lead.finalidade === "arrendamento" ? "secondary" : "default"}>
                    {lead.finalidade}
                  </Badge>
                  {lead.confianca === "baixa" && (
                    <span className="text-xs text-amber-700">Confirma antes de criar</span>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeLead(i)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              <p className="text-sm font-medium">{lead.resumo}</p>
              {lead.mensagem_original && (
                <p className="text-xs italic text-muted-foreground">"{lead.mensagem_original}"</p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <FieldText
                  label="Nome"
                  value={lead.nome ?? ""}
                  onChange={(v) => updateLead(i, { nome: v || null })}
                />
                <div>
                  <label className="text-xs text-muted-foreground">Finalidade</label>
                  <Select
                    value={lead.finalidade}
                    onValueChange={(v) =>
                      updateLead(i, { finalidade: v as QualifiedLead["finalidade"] })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="venda">Compra</SelectItem>
                      <SelectItem value="arrendamento">Arrendamento</SelectItem>
                      <SelectItem value="indefinido">Indefinido</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <FieldText
                  label="Tipologia"
                  value={lead.tipologia ?? ""}
                  onChange={(v) => updateLead(i, { tipologia: v || null })}
                />
                <FieldText
                  label="Zona"
                  value={lead.zona ?? ""}
                  onChange={(v) => updateLead(i, { zona: v || null })}
                />
                <FieldNumber
                  label="Orçamento máximo (€)"
                  value={lead.budget_max}
                  onChange={(v) => updateLead(i, { budget_max: v })}
                />
                <FieldNumber
                  label="Orçamento mínimo (€)"
                  value={lead.budget_min}
                  onChange={(v) => updateLead(i, { budget_min: v })}
                />
                <FieldNumber
                  label="Área mín. (m²)"
                  value={lead.area_min}
                  onChange={(v) => updateLead(i, { area_min: v })}
                />
                <FieldNumber
                  label="Quartos mín."
                  value={lead.quartos_min}
                  onChange={(v) => updateLead(i, { quartos_min: v })}
                />
                <FieldText
                  label="Telefone"
                  value={lead._telefone ?? ""}
                  onChange={(v) => updateLead(i, { _telefone: v })}
                />
              </div>

              {lead.caracteristicas && lead.caracteristicas.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {lead.caracteristicas.map((c) => (
                    <Badge key={c} variant="outline">{c}</Badge>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldText({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function FieldNumber({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        type="number"
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : Number(v));
        }}
      />
    </div>
  );
}