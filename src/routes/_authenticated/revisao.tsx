import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listConsultoresSemTelefone,
  setConsultorTelefone,
  bulkSetConsultorTelefone,
  listSearchesSemLocalizacao,
  setSearchLocations,
  type BulkPhoneLineResult,
  type ConsultorSemTelefone,
  type SearchSemLocalizacao,
} from "@/lib/review.functions";
import { promoteAlias } from "@/lib/geo/geo.functions";
import { LocationSelector } from "@/components/entity-selector/LocationSelector";
import { OriginalMessage } from "@/components/OriginalMessage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  downloadReviewCsv,
  downloadReviewXlsx,
  parseFilledReviewFile,
  type ParsedImportFile,
} from "@/lib/review-export";
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
} from "lucide-react";
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

      <ReimportPanel onDone={reload} />

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
              telefone: r.telefone_novo,
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
        Exporta a lista, preenche a coluna <span className="font-mono">telefone_novo</span> e volta a
        carregar aqui o ficheiro (CSV ou Excel). As procuras são atualizadas pelos{" "}
        <span className="font-mono">search_ids</span> de cada linha.
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
