// Release 1.2.14 — Editor lateral de uma procura na Revisão.
//
// Expõe os campos suportados por `updateReviewSearch` para o administrador
// corrigir uma procura existente sem reimportar. Dois botões distintos:
//  - "Guardar": persiste tudo (incluindo categorias) e mantém a procura na
//    Revisão — `motivo_indecidivel` fica intacto e não há recruzamento.
//  - "Guardar e resolver": além de gravar, limpa `motivo_indecidivel`,
//    marca como revista e recruza imediatamente no Motor Match.

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteReviewSearch,
  getReviewSearch,
  updateReviewSearch,
  type DeleteSearchResult,
  type ReviewSearchDetail,
} from "@/lib/review.functions";
import { CATEGORY_LABELS, type PropertyCategory } from "@/lib/property-taxonomy";
import { LocationSelector } from "@/components/entity-selector/LocationSelector";
import { OriginalMessage } from "@/components/OriginalMessage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";


/** Release 1.3.2 — tipo de negócio da procura (valores reais na BD). */
export type Finalidade = "venda" | "arrendamento" | "indefinido";

export const FINALIDADE_LABELS: Record<Finalidade, string> = {
  venda: "Comprador",
  arrendamento: "Arrendatário",
  indefinido: "Indefinido",
};

/** Estado editável do formulário (números como texto para permitir vazio). */
type FormState = {
  finalidade: Finalidade;
  budget_min: string;
  budget_max: string;
  area_min: string;
  quartos_min: string;
  tipologia: string;
  tipo_imovel: string;
  categorias: PropertyCategory[];
  location_ids: string[];
  contact_nome: string;
  contact_telefone: string;
};

export function toFormState(d: ReviewSearchDetail): FormState {
  const n = (v: number | null) => (v === null ? "" : String(v));
  const f = d.criteria.finalidade;
  return {
    finalidade: f === "venda" || f === "arrendamento" ? f : "indefinido",
    budget_min: n(d.criteria.budget_min),
    budget_max: n(d.criteria.budget_max),
    area_min: n(d.criteria.area_min),
    quartos_min: n(d.criteria.quartos_min),
    tipologia: d.criteria.tipologia ?? "",
    tipo_imovel: (d.criteria.tipo_imovel ?? []).join(", "),
    categorias: (d.criteria.categorias ?? []) as PropertyCategory[],
    location_ids: d.location_ids,
    contact_nome: d.contact_nome ?? "",
    contact_telefone: d.contact_telefone ?? "",
  };
}


/** Converte "" → null e texto numérico → número; devolve `undefined` se inválido. */
function numOrNull(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const v = Number(t.replace(",", "."));
  return Number.isFinite(v) ? v : undefined;
}

function listOrNull(raw: string): string[] | null {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length === 0 ? null : parts;
}

/**
 * Diff explícito: só campos alterados entram no patch, para nunca sobrescrever
 * por acidente o que o utilizador não tocou.
 */
export function buildUpdatePayload(initial: FormState, form: FormState) {
  const criteria: Record<string, unknown> = {};
  if (form.finalidade !== initial.finalidade) criteria.finalidade = form.finalidade;
  const numericKeys = ["budget_min", "budget_max", "area_min", "quartos_min"] as const;

  for (const k of numericKeys) {
    if (form[k].trim() === initial[k].trim()) continue;
    const v = numOrNull(form[k]);
    if (v === undefined) throw new Error(`Valor inválido em ${k}.`);
    criteria[k] = v;
  }
  if (form.tipologia.trim() !== initial.tipologia.trim())
    criteria.tipologia = form.tipologia.trim() || null;
  if (form.tipo_imovel.trim() !== initial.tipo_imovel.trim())
    criteria.tipo_imovel = listOrNull(form.tipo_imovel);
  const catsChanged =
    form.categorias.length !== initial.categorias.length ||
    form.categorias.some((c) => !initial.categorias.includes(c));
  if (catsChanged) criteria.categorias = form.categorias;

  const payload: Record<string, unknown> = { criteria };
  if (form.contact_nome.trim() !== initial.contact_nome.trim())
    payload.contact_nome = form.contact_nome.trim() || null;
  if (form.contact_telefone.trim() !== initial.contact_telefone.trim())
    payload.contact_telefone = form.contact_telefone.trim() || null;
  const locsChanged =
    form.location_ids.length !== initial.location_ids.length ||
    form.location_ids.some((id) => !initial.location_ids.includes(id));
  if (locsChanged) payload.location_ids = form.location_ids;
  return payload;
}

export function SearchEditSheet({
  searchId,
  onClose,
  onSaved,
  onDeleted,
}: {
  searchId: string | null;
  onClose: () => void;
  /** Chamado com `resolved=true` quando a procura saiu da Revisão. */
  onSaved: (id: string, resolved: boolean) => void;
  /** Release 1.3.2 — chamado após apagar permanentemente a procura. */
  onDeleted?: (id: string) => void;
}) {
  const loadFn = useServerFn(getReviewSearch);
  const saveFn = useServerFn(updateReviewSearch);
  const deleteFn = useServerFn(deleteReviewSearch);
  const [detail, setDetail] = useState<ReviewSearchDetail | null>(null);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<DeleteSearchResult | null>(null);


  useEffect(() => {
    if (!searchId) {
      setDetail(null);
      setForm(null);
      setInitial(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadFn({ data: { id: searchId } })
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        const f = toFormState(d);
        setInitial(f);
        setForm(f);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro ao carregar procura"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchId, loadFn]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((cur) => (cur ? { ...cur, [k]: v } : cur));

  const toggleCat = (c: PropertyCategory) =>
    setForm((cur) =>
      cur
        ? {
            ...cur,
            categorias: cur.categorias.includes(c)
              ? cur.categorias.filter((x) => x !== c)
              : [...cur.categorias, c],
          }
        : cur,
    );

  const submit = async (resolve: boolean) => {
    if (!searchId || !form || !initial) return;
    setBusy(true);
    try {
      const payload = buildUpdatePayload(initial, form);
      await saveFn({ data: { id: searchId, resolve, ...payload } as any });
      toast.success(
        resolve
          ? "Procura atualizada, resolvida e recruzada no Motor Match."
          : "Alterações guardadas. A procura continua na Revisão.",
      );
      setInitial(form);
      onSaved(searchId, resolve);
      if (resolve) onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao guardar");
    } finally {
      setBusy(false);
    }
  };

  /** Abre o diálogo de confirmação já com o impacto real (modo simulação). */
  const askDelete = async () => {
    if (!searchId) return;
    setConfirmOpen(true);
    setPreview(null);
    try {
      setPreview(await deleteFn({ data: { id: searchId, apply: false } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao preparar eliminação");
      setConfirmOpen(false);
    }
  };

  const confirmDelete = async () => {
    if (!searchId) return;
    setBusy(true);
    try {
      const r = await deleteFn({ data: { id: searchId, apply: true } });
      if (!r.encontrada) {
        toast.error("Procura já não existe.");
      } else {
        toast.success(
          `Procura apagada. Removidas ${r.oportunidades_removidas} oportunidades, ` +
            `${r.notificacoes_removidas} notificações e ${r.estados_removidos} estados.`,
        );
      }
      setConfirmOpen(false);
      onDeleted?.(searchId);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao apagar");
    } finally {
      setBusy(false);
    }
  };

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );



  return (
    <Sheet open={!!searchId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Editar procura</SheetTitle>
          <SheetDescription>
            Corrija os critérios diretamente. “Guardar” mantém a procura na Revisão; “Guardar e
            resolver” reintegra-a no Motor Match.
          </SheetDescription>
        </SheetHeader>

        {loading || !form || !detail ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> A carregar…
          </div>
        ) : (
          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{detail.resumo ?? "(sem resumo)"}</span>
                {detail.origem && <Badge variant="outline">{detail.origem}</Badge>}
                {detail.criteria.categoria_origem && (
                  <Badge variant="secondary" className="text-[10px]">
                    {detail.criteria.categoria_origem}
                  </Badge>
                )}
                {detail.criteria.motivo_indecidivel && (
                  <Badge variant="secondary" className="text-[10px]">
                    {detail.criteria.motivo_indecidivel === "multi_uso"
                      ? "Multi-uso"
                      : detail.criteria.motivo_indecidivel}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {detail.consultor_nome ?? detail.contact_nome ?? "—"}
                {detail.grupo_whatsapp ? ` · ${detail.grupo_whatsapp}` : ""} ·{" "}
                {new Date(detail.created_at).toLocaleDateString("pt-PT")}
              </p>
              <OriginalMessage texto={detail.texto_original} origem={detail.origem} />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Tipo de imóvel (categorias)</Label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(CATEGORY_LABELS) as PropertyCategory[]).map((c) => (
                  <Button
                    key={c}
                    type="button"
                    size="sm"
                    variant={form.categorias.includes(c) ? "default" : "outline"}
                    onClick={() => toggleCat(c)}
                  >
                    {CATEGORY_LABELS[c]}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Orçamento mínimo (€)"
                value={form.budget_min}
                onChange={(v) => set("budget_min", v)}
              />
              <Field
                label="Orçamento máximo (€)"
                value={form.budget_max}
                onChange={(v) => set("budget_max", v)}
              />
              <Field
                label="Área mínima (m²)"
                value={form.area_min}
                onChange={(v) => set("area_min", v)}
                hint="Vazio = sem exigência de área"
              />
              <Field
                label="Quartos mínimos"
                value={form.quartos_min}
                onChange={(v) => set("quartos_min", v)}
              />
              <Field
                label="Tipologia"
                value={form.tipologia}
                onChange={(v) => set("tipologia", v)}
                placeholder="T2, T3…"
              />
              <Field
                label="Tipo de imóvel (texto original)"
                value={form.tipo_imovel}
                onChange={(v) => set("tipo_imovel", v)}
                placeholder="Armazém, Loja"
                hint="Separar por vírgulas"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Localização (biblioteca geográfica)</Label>
              <LocationSelector
                value={form.location_ids}
                onChange={(ids) => set("location_ids", ids)}
                multiple
                placeholder="Pesquisar concelho, freguesia ou zona…"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Nome do contacto"
                value={form.contact_nome}
                onChange={(v) => set("contact_nome", v)}
              />
              <Field
                label="Telefone do contacto"
                value={form.contact_telefone}
                onChange={(v) => set("contact_telefone", v)}
                placeholder="+351 …"
              />
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void submit(false)}>
                <Save className="mr-1 h-4 w-4" /> {busy ? "A guardar…" : "Guardar"}
              </Button>
              <Button type="button" disabled={busy} onClick={() => void submit(true)}>
                <Sparkles className="mr-1 h-4 w-4" /> Guardar e resolver
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
