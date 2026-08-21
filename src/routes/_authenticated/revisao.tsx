import { isCurrentUserAdmin } from "@/lib/admin.functions";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listConsultoresSemTelefone,
  setConsultorTelefone,
  bulkSetConsultorTelefone,
  listSearchesSemLocalizacao,
  setSearchLocations,
  setSearchLocationsBulk,
  discardSearches,
  listSearchesSemTipo,
  setSearchCategories,
  type BulkPhoneLineResult,
  type ConsultorSemTelefone,
  type SearchSemLocalizacaoItem,
  type SearchSemTipoItem,
} from "@/lib/review.functions";
import { CATEGORY_LABELS, type PropertyCategory } from "@/lib/property-taxonomy";
import { promoteAlias } from "@/lib/geo/geo.functions";
import { normalizeGeoText } from "@/lib/geo/geo-context";
import { LocationSelector } from "@/components/entity-selector/LocationSelector";
import { OriginalMessage } from "@/components/OriginalMessage";
import { SearchEditSheet } from "@/components/review/SearchEditSheet";
import {
  ContactSuggestPanel,
  type SuggestionMap,
} from "@/components/review/ContactSuggestPanel";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  downloadReviewCsv,
  downloadReviewXlsx,
  parseFilledReviewFile,
  type ParsedImportFile,
} from "@/lib/review-export";
import type { Suggestion } from "@/lib/contacts-file";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  Download,
  MapPin,
  Phone,
  Save,
  Upload,
  FileSpreadsheet,
  Globe,
  Trash2,
  Building2,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";

// Release 1.2.14 — o editor lateral é acessível de qualquer aba. O estado vive
// no topo da página e cada lista abre-o com o id da procura.
import { createContext, useContext } from "react";

type EditCtx = { edit: (id: string) => void };
const SearchEditContext = createContext<EditCtx>({ edit: () => {} });

export function useSearchEdit() {
  return useContext(SearchEditContext);
}

function EditSearchButton({ id }: { id: string }) {
  const { edit } = useSearchEdit();
  return (
    <Button type="button" size="sm" variant="outline" onClick={() => edit(id)}>
      <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
    </Button>
  );
}

export const Route = createFileRoute("/_authenticated/revisao")({
  // Item 1 — página exclusiva de Admin. `ssr: false` porque a verificação
  // depende da sessão do browser.
  ssr: false,
  beforeLoad: async () => {
    const res = await isCurrentUserAdmin();
    if (!res.isAdmin) throw redirect({ to: "/imoveis" });
  },
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);
  // Release 1.2.18 — sugestões vindas do ficheiro de contactos (só em memória).
  const [suggestions, setSuggestions] = useState<SuggestionMap>(new Map());

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
    <SearchEditContext.Provider value={{ edit: setEditingId }}>
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-lg bg-secondary text-primary inline-flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-3xl font-bold tracking-tight">Revisão manual</h1>
          <p className="text-muted-foreground mt-1">
            Corrija aqui o que o sistema não conseguiu resolver: contactos sem
            telefone válido e procuras sem localização resolvida.
          </p>
        </div>
      </div>

      <Tabs defaultValue="telefone" className="space-y-6">
        <TabsList>
          <TabsTrigger value="telefone">
            <Phone className="w-4 h-4 mr-1" /> Sem telefone
          </TabsTrigger>
          <TabsTrigger value="localizacao">
            <MapPin className="w-4 h-4 mr-1" /> Sem localização
          </TabsTrigger>
          <TabsTrigger value="tipo">
            <Building2 className="w-4 h-4 mr-1" /> Sem tipo de imóvel
          </TabsTrigger>
        </TabsList>

        <TabsContent value="telefone" className="space-y-6">
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={loading || items.length === 0}>
                  <Download className="w-4 h-4 mr-1" /> Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void downloadReviewXlsx(items)}>
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadReviewCsv(items)}>CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <ContactSuggestPanel
            items={items}
            onSuggestions={(m) => {
              setSuggestions(m);
              setPrefills(new Map());
            }}
            onApply={(s) => {
              setPrefills((prev) => {
                const next = new Map(prev);
                next.set(s.key, { telefone: s.telefone ?? "", nonce: Date.now() });
                return next;
              });
              document
                .getElementById(`contacto-${s.key}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />

          <ReimportPanel onDone={reload} />

          {loading ? (
            <p className="text-sm text-muted-foreground">A carregar…</p>
          ) : items.length === 0 ? (
            <Card className="p-6 text-center text-muted-foreground">
              Sem contactos por corrigir. Todos os consultores têm telefone válido.
            </Card>
          ) : (
            items.map((it) => (
              <ContactoCard
                key={it.key}
                item={it}
                sugestao={suggestions.get(it.key) ?? null}
                prefill={prefills.get(it.key) ?? null}
                onSaved={() => removeLocal(it.key)}
              />
            ))
          )}

        </TabsContent>

        <TabsContent value="localizacao">
          <SemLocalizacaoPanel resolvedIds={resolvedIds} />
        </TabsContent>

        <TabsContent value="tipo">
          <SemTipoPanel resolvedIds={resolvedIds} />
        </TabsContent>
      </Tabs>

      <SearchEditSheet
        searchId={editingId}
        onClose={() => setEditingId(null)}
        onSaved={(id, resolved) => {
          if (resolved) setResolvedIds((cur) => (cur.includes(id) ? cur : [...cur, id]));
        }}
      />
    </div>
    </SearchEditContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Release 1.2.12 — Procuras sem tipo de imóvel decidido. Estas procuras estão
// fora do Motor Match (falham o filtro de tipo) até alguém decidir a categoria.
// ---------------------------------------------------------------------------

function SemTipoPanel({ resolvedIds }: { resolvedIds: string[] }) {
  const listFn = useServerFn(listSearchesSemTipo);
  const saveFn = useServerFn(setSearchCategories);
  const [items, setItems] = useState<SearchSemTipoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<PropertyCategory[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    setLoading(true);
    setSelected(new Set());
    listFn()
      .then((r) => setItems(r.items))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro"))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    reload();
  }, []);

  const q = query.trim().toLowerCase();
  const visible = items.filter((it) => {
    if (resolvedIds.includes(it.id)) return false;
    if (!q) return true;
    return [it.resumo, it.texto_original, it.consultor_nome, it.contact_nome, it.tipologia]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleCat = (c: PropertyCategory) =>
    setCats((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  const apply = async () => {
    setBusy(true);
    try {
      const ids = [...selected];
      const r = await saveFn({ data: { ids, categorias: cats } });
      toast.success(`${r.updated} procura(s) atualizada(s) e recruzada(s).`);
      setItems((cur) => cur.filter((x) => !selected.has(x.id)));
      setSelected(new Set());
      setCats([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gravar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold">Procuras sem tipo de imóvel</h2>
          <Badge variant="secondary" className="ml-auto tabular-nums">
            {loading ? "…" : `${visible.length} / ${items.length}`}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          O sistema não conseguiu decidir que tipo de imóvel a procura pretende, por isso ela
          <strong> não produz matches</strong> (em vez de aceitar tudo). Escolha as categorias,
          marque as procuras e grave — voltam imediatamente ao Motor Match.
        </p>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pesquisar na mensagem, consultor ou tipologia…"
        />
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CATEGORY_LABELS) as PropertyCategory[]).map((c) => (
            <Button
              key={c}
              type="button"
              size="sm"
              variant={cats.includes(c) ? "default" : "outline"}
              onClick={() => toggleCat(c)}
            >
              {CATEGORY_LABELS[c]}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy || cats.length === 0 || selected.size === 0}
            onClick={() => void apply()}
          >
            <Save className="w-4 h-4 mr-1" />
            {busy ? "A gravar…" : `Aplicar a ${selected.size} procura(s)`}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSelected(new Set(visible.map((v) => v.id)))}
            disabled={visible.length === 0}
          >
            Marcar visíveis
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={reload} disabled={loading}>
            Recarregar
          </Button>
        </div>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : visible.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">
          Todas as procuras ativas têm tipo de imóvel definido.
        </Card>
      ) : (
        visible.map((it) => (
          <Card key={it.id} className="p-4 space-y-2">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={selected.has(it.id)}
                onChange={() => toggle(it.id)}
                aria-label="Selecionar procura"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{it.resumo ?? "(sem resumo)"}</span>
                  {it.origem && <Badge variant="outline">{it.origem}</Badge>}
                  {it.tipologia && <Badge variant="secondary">{it.tipologia}</Badge>}
                  {it.categoria_origem && (
                    <Badge variant="outline" className="text-[10px]">
                      {it.categoria_origem}
                    </Badge>
                  )}
                  {it.sinais_multi_uso && it.sinais_multi_uso.length > 1 && (
                    <Badge variant="secondary" className="text-[10px]">
                      Multi-uso: {it.sinais_multi_uso.map((c) => CATEGORY_LABELS[c as PropertyCategory] ?? c).join(", ")}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {it.consultor_nome ?? it.contact_nome ?? "—"}
                  {it.grupo_whatsapp ? ` · ${it.grupo_whatsapp}` : ""}
                </div>
                {it.texto_original && <OriginalMessage texto={it.texto_original} origem={it.origem} />}
                <div className="pt-1">
                  <EditSearchButton id={it.id} />
                </div>
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

function ContactoCard({
  item,
  onSaved,
  sugestao,
}: {
  item: ConsultorSemTelefone;
  onSaved: () => void;
  sugestao?: Suggestion | null;
}) {
  const saveFn = useServerFn(setConsultorTelefone);
  const [telefone, setTelefone] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // A sugestão apenas pré-preenche o campo; a gravação continua a ser manual.
  const sugerido = sugestao?.telefone ?? null;
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (sugerido && !applied && telefone.trim() === "") {
      setTelefone(sugerido);
      setApplied(true);
    }
  }, [sugerido]);

  // Update em massa: o mesmo número é aplicado a TODAS as procuras deste
  // consultor. Quando é mais do que uma, exige confirmação visual explícita.
  const requestSave = () => {
    if (!telefone.trim()) {
      toast.error("Introduza um número de telefone.");
      return;
    }
    if (item.procuras_afetadas > 1) setConfirmOpen(true);
    else void save();
  };

  const save = async () => {
    const t = telefone.trim();
    if (!t) {
      toast.error("Introduza um número de telefone.");
      return;
    }
    setConfirmOpen(false);
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
              if (e.key === "Enter") requestSave();
            }}
          />
          {sugestao?.telefone && (
            <p className="text-xs text-muted-foreground mt-1">
              Sugerido de <span className="font-medium">{sugestao.contacto_nome}</span> (
              {Math.round(sugestao.score * 100)}% de correspondência)
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Este número vai ser aplicado a {item.procuras_afetadas} procura(s) deste consultor.
          </p>
        </div>
        <Button size="sm" onClick={requestSave} disabled={saving}>
          <Save className="w-4 h-4 mr-1" />
          {saving ? "A guardar…" : "Guardar"}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar a {item.procuras_afetadas} procuras?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  O número <span className="font-mono">{telefone.trim()}</span> vai ser gravado em{" "}
                  <strong>{item.procuras_afetadas} procuras</strong> de{" "}
                  {item.nome ?? "(sem nome)"} — ou seja, também nas{" "}
                  {item.procuras_afetadas - 1} outras procuras deste consultor, não só numa.
                </p>
                {item.amostras.length > 0 && (
                  <ul className="list-disc pl-4 text-xs">
                    {item.amostras.map((a) => (
                      <li key={a.id}>
                        {a.origem ? `${a.origem} · ` : ""}
                        {a.created_at?.slice(0, 10)} — {(a.texto ?? "").slice(0, 80) || "(sem texto)"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save()}>
              Guardar nas {item.procuras_afetadas} procuras
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {item.amostras[0]?.texto && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Ver contexto ({item.amostras.length})</summary>
          <div className="mt-2 space-y-2">
            {item.amostras.map((a) => (
              <div key={a.id} className="bg-muted/50 rounded p-2 whitespace-pre-wrap">
                {a.origem && <Badge variant="outline" className="mr-1">{a.origem}</Badge>}
                {a.texto?.slice(0, 240)}
                <div className="pt-2">
                  <EditSearchButton id={a.id} />
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}

const CHUNK = 50;

function ReimportPanel({ onDone }: { onDone: () => void }) {
  const bulkFn = useServerFn(bulkSetConsultorTelefone);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedImportFile | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BulkPhoneLineResult[] | null>(null);

  const pick = async (f: File | null) => {
    setFile(f);
    setParsed(null);
    setResults(null);
    setProgress(0);
    if (!f) return;
    try {
      setParsed(await parseFilledReviewFile(f));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler o ficheiro.");
    }
  };

  const apply = async () => {
    if (!parsed) return;
    const prontos = parsed.rows.filter((r) => r.status === "pronto");
    if (prontos.length === 0) return toast.error("Nenhuma linha pronta para atualizar.");
    setRunning(true);
    setProgress(0);
    const acc: BulkPhoneLineResult[] = [];
    try {
      for (let i = 0; i < prontos.length; i += CHUNK) {
        const slice = prontos.slice(i, i + CHUNK);
        const res = await bulkFn({
          data: {
            linhas: slice.map((r) => ({
              linha: r.linha,
              search_ids: r.search_ids,
              telefone: r.telefone_novo || undefined,
              nome_novo: r.nome_novo || undefined,
            })),
          },
        });
        acc.push(...res.resultados);
        setProgress(Math.round(((i + slice.length) / prontos.length) * 100));
      }
      setResults(acc);
      const ok = acc.filter((r) => r.status === "atualizada").length;
      const procuras = acc.reduce((s, r) => s + r.procuras_atualizadas, 0);
      toast.success(`${ok} contacto(s) atualizado(s) · ${procuras} procura(s).`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na reimportação.");
    } finally {
      setRunning(false);
    }
  };

  const erros = results?.filter((r) => r.status === "erro") ?? [];
  const invalidas = parsed?.rows.filter((r) => r.status === "invalido") ?? [];

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-semibold">Reimportar ficheiro preenchido</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Exporta a lista, preenche as colunas <span className="font-mono">telefone_novo</span> e/ou{" "}
        <span className="font-mono">nome_novo</span> e volta a carregar aqui o ficheiro (CSV ou
        Excel). As procuras são atualizadas pelos <span className="font-mono">search_ids</span> de
        cada linha; corrigir o nome também atualiza a chave de deduplicação e a aprendizagem de
        contactos.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0] ?? null)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <Upload className="w-4 h-4 mr-1" />
          {file ? "Escolher outro ficheiro" : "Escolher ficheiro"}
        </Button>
        {file && <span className="text-xs text-muted-foreground">{file.name}</span>}
      </div>

      {parsed && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="Prontas" value={parsed.prontos} />
            <Stat label="Ignoradas" value={parsed.ignorados} />
            <Stat label="Inválidas" value={parsed.invalidos} />
          </div>
          {invalidas.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Ver linhas inválidas ({invalidas.length})</summary>
              <ul className="mt-2 space-y-1">
                {invalidas.slice(0, 50).map((r) => (
                  <li key={r.linha}>
                    Linha {r.linha}: {r.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Button size="sm" onClick={apply} disabled={running || parsed.prontos === 0}>
            {running ? "A atualizar…" : `Atualizar ${parsed.prontos} contacto(s)`}
          </Button>
          {running && <Progress value={progress} />}
        </div>
      )}

      {results && (
        <div className="space-y-2 text-xs">
          <p>
            <strong>{results.filter((r) => r.status === "atualizada").length}</strong> contacto(s)
            atualizado(s) ·{" "}
            <strong>{results.reduce((s, r) => s + r.procuras_atualizadas, 0)}</strong> procura(s) ·{" "}
            <strong>{erros.length}</strong> erro(s)
          </p>
          {erros.length > 0 && (
            <ul className="space-y-1 text-muted-foreground">
              {erros.slice(0, 50).map((r) => (
                <li key={r.linha}>
                  Linha {r.linha}: {r.motivo}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-2 py-1">
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Procuras sem localização resolvida — revisão manual, uma a uma.
// A mensagem original fica visível para o administrador decidir; a correção
// é feita exclusivamente pelo LocationSelector (IDs da biblioteca).
// ---------------------------------------------------------------------------

function SemLocalizacaoPanel({ resolvedIds }: { resolvedIds: string[] }) {
  const listFn = useServerFn(listSearchesSemLocalizacao);
  const discardFn = useServerFn(discardSearches);
  const [items, setItems] = useState<SearchSemLocalizacaoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [onlyWithText, setOnlyWithText] = useState(false);
  // Item 4b/4c — descarte em lote das procuras fora de Portugal, sempre com
  // a lista visível para confirmação antes de aplicar.
  const [onlyForeign, setOnlyForeign] = useState(false);
  const [confirmForeign, setConfirmForeign] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const reload = () => {
    setLoading(true);
    listFn()
      .then((r) => setItems(r.items))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro"))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    reload();
  }, []);

  const foreignItems = items.filter((i) => i.foreign !== null);

  const discardForeign = async () => {
    setBulkBusy(true);
    try {
      const ids = foreignItems.map((i) => i.id);
      const r = await discardFn({
        data: { ids, motivo: "Localização fora de Portugal (fora do âmbito do motor geográfico)" },
      });
      toast.success(`${r.discarded} procura(s) descartada(s).`);
      setItems((cur) => cur.filter((x) => x.foreign === null));
      setConfirmForeign(false);
      setOnlyForeign(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao descartar");
    } finally {
      setBulkBusy(false);
    }
  };

  // Item 7 — sugestão automática: agrupa procuras pelo mesmo texto geográfico
  // não resolvido, para que uma decisão humana resolva o grupo inteiro.
  const geoTextOf = (it: SearchSemLocalizacaoItem) =>
    it.criteria_geo.zona ??
    it.criteria_geo.freguesia ??
    it.criteria_geo.municipio ??
    it.criteria_geo.distrito ??
    null;
  const groups = new Map<string, string[]>();
  for (const it of items) {
    const key = normalizeGeoText(geoTextOf(it));
    if (!key) continue;
    const cur = groups.get(key);
    if (cur) cur.push(it.id);
    else groups.set(key, [it.id]);
  }

  const q = query.trim().toLowerCase();
  const visible = items.filter((it) => {
    if (resolvedIds.includes(it.id)) return false;
    if (onlyWithText && !(it.texto_original ?? "").trim()) return false;
    if (onlyForeign && it.foreign === null) return false;
    if (!q) return true;
    const hay = [
      it.resumo,
      it.texto_original,
      it.consultor_nome,
      it.contact_nome,
      it.grupo_whatsapp,
      it.criteria_geo.zona,
      it.criteria_geo.freguesia,
      it.criteria_geo.municipio,
      it.criteria_geo.distrito,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold">Procuras sem localização resolvida</h2>
          <Badge variant="secondary" className="ml-auto tabular-nums">
            {loading ? "…" : `${visible.length} / ${items.length}`}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Procuras ativas sem <span className="font-mono">location_ids</span> — o backfill não
          encontrou texto geográfico aproveitável. Escolha a localização correta e a procura volta
          imediatamente ao Motor Match.
        </p>
        <div className="flex flex-col md:flex-row gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar na mensagem, consultor ou grupo…"
          />
          <Button
            type="button"
            variant={onlyWithText ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyWithText((v) => !v)}
          >
            Só com mensagem original
          </Button>
          <Button
            type="button"
            variant={onlyForeign ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyForeign((v) => !v)}
          >
            Fora de Portugal ({foreignItems.length})
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={reload} disabled={loading}>
            Recarregar
          </Button>
        </div>

        {foreignItems.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Globe className="w-4 h-4 text-amber-700" />
              <span className="font-medium text-amber-900">
                {foreignItems.length} procura(s) com localização fora de Portugal
              </span>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="ml-auto"
                onClick={() => setConfirmForeign((v) => !v)}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                {confirmForeign ? "Fechar lista" : "Ver lista e descartar"}
              </Button>
            </div>
            {confirmForeign && (
              <>
                <div className="max-h-64 overflow-auto rounded border bg-background">
                  <table className="w-full text-left">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-2 py-1 font-medium">Localização no pedido</th>
                        <th className="px-2 py-1 font-medium">País detetado</th>
                        <th className="px-2 py-1 font-medium">Origem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {foreignItems.map((f) => (
                        <tr key={f.id} className="border-t">
                          <td className="px-2 py-1">
                            {f.criteria_geo.zona ??
                              f.criteria_geo.municipio ??
                              f.criteria_geo.freguesia ??
                              f.criteria_geo.distrito ??
                              "(sem zona)"}
                          </td>
                          <td className="px-2 py-1">
                            {f.foreign?.country}{" "}
                            <span className="text-muted-foreground">({f.foreign?.marker})</span>
                          </td>
                          <td className="px-2 py-1">{f.origem ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-amber-900">
                  Descartar arquiva estas procuras (soft-delete): saem das listas e do Motor Match,
                  mas o registo e a mensagem original ficam guardados.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={discardForeign}
                  disabled={bulkBusy}
                >
                  {bulkBusy
                    ? "A descartar…"
                    : `Confirmar e descartar ${foreignItems.length} procura(s)`}
                </Button>
              </>
            )}
          </div>
        )}
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : visible.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">
          Nenhuma procura pendente de localização.
        </Card>
      ) : (
        visible.map((it) => (
          <SemLocalizacaoCard
            key={it.id}
            item={it}
            sameTextIds={groups.get(normalizeGeoText(geoTextOf(it))) ?? [it.id]}
            onDone={(resolvedIds) =>
              setItems((cur) => cur.filter((x) => !resolvedIds.includes(x.id)))
            }
          />
        ))
      )}
    </div>
  );
}

function SemLocalizacaoCard({
  item,
  sameTextIds,
  onDone,
}: {
  item: SearchSemLocalizacaoItem;
  /** Todas as procuras pendentes com o mesmo texto geográfico (inclui esta). */
  sameTextIds: string[];
  onDone: (resolvedIds: string[]) => void;
}) {
  const saveFn = useServerFn(setSearchLocations);
  const saveBulkFn = useServerFn(setSearchLocationsBulk);
  const aliasFn = useServerFn(promoteAlias);
  const discardFn = useServerFn(discardSearches);
  const [ids, setIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [learn, setLearn] = useState(true);
  const [discarding, setDiscarding] = useState(false);
  const others = sameTextIds.filter((id) => id !== item.id);
  const [applyGroup, setApplyGroup] = useState(true);

  const textoGeo =
    item.criteria_geo.zona ??
    item.criteria_geo.freguesia ??
    item.criteria_geo.municipio ??
    item.criteria_geo.distrito ??
    null;

  const save = async () => {
    if (ids.length === 0) {
      toast.error("Selecione pelo menos uma localização.");
      return;
    }
    setSaving(true);
    const groupMode = applyGroup && others.length > 0;
    try {
      if (groupMode) {
        const r = await saveBulkFn({ data: { ids: sameTextIds, location_ids: ids } });
        toast.success(`Localização aplicada a ${r.updated} procura(s) com o mesmo texto.`);
      } else {
        await saveFn({ data: { id: item.id, location_ids: ids } });
        toast.success("Localização guardada e procura recruzada.");
      }
      if (learn && textoGeo && textoGeo.trim().length > 1) {
        try {
          await aliasFn({ data: { text: textoGeo, location_ids: ids, origem: "revisao" } });
        } catch {
          // Aprendizagem é complementar — não bloqueia a gravação.
        }
      }
      onDone(groupMode ? sameTextIds : [item.id]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  };

  // Item 4a — descartar uma entrada que não é uma procura real (ex. anúncio de
  // imóvel à venda importado por engano) ou está fora do âmbito geográfico.
  const discard = async (motivo: string) => {
    setDiscarding(true);
    try {
      await discardFn({ data: { ids: [item.id], motivo } });
      toast.success("Procura descartada (arquivada).");
      onDone([item.id]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao descartar");
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <Card className="p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">
          <MapPin className="w-3 h-3 mr-1" /> Sem localização
        </Badge>
        {item.origem && <Badge variant="secondary">{item.origem}</Badge>}
        {item.foreign && (
          <Badge variant="destructive">
            <Globe className="w-3 h-3 mr-1" /> {item.foreign.country}
          </Badge>
        )}
        {item.offer && (
          <Badge variant="destructive" title={`Marcador: ${item.offer.marker}`}>
            Parece anúncio de venda
          </Badge>
        )}
        <span className="font-medium">
          {item.consultor_nome ?? item.contact_nome ?? "(sem consultor)"}
        </span>
        {item.grupo_whatsapp && (
          <span className="text-xs text-muted-foreground">{item.grupo_whatsapp}</span>
        )}
        <span className="text-muted-foreground ml-auto text-xs">
          {new Date(item.created_at).toLocaleDateString("pt-PT")}
        </span>
      </div>

      {item.resumo && <p className="text-sm">{item.resumo}</p>}

      {textoGeo && (
        <p className="text-xs text-muted-foreground">
          Texto geográfico original: <span className="font-mono">{textoGeo}</span> (não resolvido)
        </p>
      )}

      <OriginalMessage texto={item.texto_original} origem={item.origem} defaultOpen />

      <div className="space-y-2">
        <Label className="text-xs">Localização (biblioteca geográfica)</Label>
        <LocationSelector
          value={ids}
          onChange={setIds}
          multiple
          placeholder="Pesquisar concelho, freguesia ou zona…"
        />
      </div>

      {others.length > 0 && (
        <label className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
          <input
            type="checkbox"
            checked={applyGroup}
            onChange={(e) => setApplyGroup(e.target.checked)}
            className="accent-primary mt-0.5"
          />
          <span>
            Existem <strong>{others.length}</strong> outra(s) procura(s) pendentes com o mesmo texto
            geográfico{textoGeo ? ` (“${textoGeo}”)` : ""}. Aplicar a mesma localização a todas.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving || ids.length === 0}>
          <Save className="w-4 h-4 mr-1" />
          {saving ? "A guardar…" : "Guardar localização"}
        </Button>
        {textoGeo && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={learn}
              onChange={(e) => setLearn(e.target.checked)}
              className="accent-primary"
            />
            Guardar interpretação de “{textoGeo}” para o futuro
          </label>
        )}
        <div className="ml-auto flex gap-2">
          <EditSearchButton id={item.id} />
          <Button
            size="sm"
            variant="outline"
            disabled={discarding}
            onClick={() => discard("Não é uma procura real (ex. anúncio de imóvel à venda)")}
          >
            <Trash2 className="w-4 h-4 mr-1" /> Não é procura
          </Button>
          {item.foreign && (
            <Button
              size="sm"
              variant="destructive"
              disabled={discarding}
              onClick={() => discard(`Localização fora de Portugal (${item.foreign!.country})`)}
            >
              <Globe className="w-4 h-4 mr-1" /> Fora de Portugal
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
