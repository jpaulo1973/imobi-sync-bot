import { isCurrentUserAdmin } from "@/lib/admin.functions";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  startExcelImport,
  processExcelChunk,
  finalizeExcelImport,
  type ExcelImportResult,
  type ChunkCounters,
} from "@/lib/excel-import.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FileSpreadsheet, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/importar")({
  // Item 1 — página exclusiva de Admin. `ssr: false` porque a verificação
  // depende da sessão do browser.
  ssr: false,
  beforeLoad: async () => {
    const res = await isCurrentUserAdmin();
    if (!res.isAdmin) throw redirect({ to: "/imoveis" });
  },
  head: () => ({
    meta: [
      { title: "Importar Procuras (Excel) — Property Match" },
      {
        name: "description",
        content:
          "Carrega um Excel com procuras de compradores. O Property Match interpreta cada linha, atualiza as procuras existentes e cruza automaticamente com a tua carteira.",
      },
    ],
  }),
  component: ImportarPage,
});

const CHUNK_SIZE = 25;

/** Linha do relatório com a origem (ficheiro) — item 10, importação múltipla. */
type ReportLine = ExcelImportResult["linhas"][number] & { ficheiro: string };

type Phase = "idle" | "parse" | "processing" | "finalizing" | "done" | "error";

function emptyCounters(): ChunkCounters {
  return {
    novas: 0,
    atualizadas: 0,
    duplicados_exatos_fundidos: 0,
    mantidas_separadas: 0,
    sinalizadas_revisao: 0,
    ignoradas_sem_contacto: 0,
    descartadas_anuncio: 0,
    erros: 0,
  };
}

function ImportarPage() {
  const startFn = useServerFn(startExcelImport);
  const chunkFn = useServerFn(processExcelChunk);
  const finalizeFn = useServerFn(finalizeExcelImport);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<
    (Omit<ExcelImportResult, "linhas"> & { linhas: ReportLine[]; procuras: number }) | null
  >(null);
  // Item E — mostrar só as linhas que originaram mais do que uma procura.
  const [onlyMulti, setOnlyMulti] = useState(false);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [total, setTotal] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [running, setRunning] = useState<ChunkCounters>(emptyCounters());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fileToB64 = (f: File) =>
    new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(f);
    });

  const submit = async () => {
    if (files.length === 0) return toast.error("Escolhe pelo menos um ficheiro Excel.");
    setLoading(true);
    setResult(null);
    setProcessed(0);
    setTotal(0);
    setRunning(emptyCounters());
    setElapsedMs(0);
    setHeaderRow(null);
    setCurrentFile(null);
    setPhase("parse");
    const start = Date.now();
    try {
      // Todos os ficheiros do lote partilham o MESMO batch_id: a deduplicação
      // do upsert vê as linhas dos ficheiros anteriores e a finalização só
      // remove procuras que não constam de nenhum dos ficheiros escolhidos.
      const parsed: Array<{ file: File; res: Awaited<ReturnType<typeof startFn>> }> = [];
      for (const f of files) {
        setCurrentFile(f.name);
        const b64 = await fileToB64(f);
        const res = await startFn({ data: { fileBase64: b64, filename: f.name } });
        parsed.push({ file: f, res });
      }
      const batch_id = parsed[0].res.batch_id;
      const expires_at = parsed[0].res.expires_at;
      setHeaderRow(parsed[0].res.header_row);
      const analisadas = parsed.reduce((acc, p) => acc + p.res.total, 0);
      setTotal(analisadas);
      setPhase("processing");

      const counters = emptyCounters();
      const linhas: ReportLine[] = [];
      for (const p of parsed) {
        setCurrentFile(p.file.name);
        for (let i = 0; i < p.res.rows.length; i += CHUNK_SIZE) {
          const slice = p.res.rows.slice(i, i + CHUNK_SIZE);
          const chunkRes = await chunkFn({
            data: { batch_id, expires_at, rows: slice },
          });
          (Object.keys(counters) as (keyof ChunkCounters)[]).forEach((k) => {
            counters[k] += chunkRes.counters[k];
          });
          linhas.push(...chunkRes.linhas.map((l) => ({ ...l, ficheiro: p.file.name })));
          setProcessed((n) => n + slice.length);
          setRunning({ ...counters });
        }
      }

      setPhase("finalizing");
      setCurrentFile(null);
      const fin = await finalizeFn({ data: { batch_id } });
      const somaFinal =
        counters.novas +
        counters.atualizadas +
        counters.duplicados_exatos_fundidos +
        counters.mantidas_separadas +
        counters.sinalizadas_revisao +
        counters.ignoradas_sem_contacto +
        counters.descartadas_anuncio +
        counters.erros;
      setResult({
        analisadas,
        ...counters,
        removidas: fin.removidas,
        matches: fin.matches,
        batch_id,
        procuras: somaFinal,
        // Cada linha do ficheiro produz exatamente uma linha de relatório; os
        // contadores contam PROCURAS (uma linha pode originar várias).
        total_check: linhas.length === analisadas,
        linhas,
      });
      setElapsedMs(Date.now() - start);
      setPhase("done");
      toast.success(
        `${files.length} ficheiro(s) · ${counters.novas} novas · ${counters.atualizadas} atualizadas · ${counters.duplicados_exatos_fundidos} duplicados · ${counters.sinalizadas_revisao} revisão · ${counters.ignoradas_sem_contacto} ignoradas · ${counters.descartadas_anuncio} descartadas · ${counters.erros} erro(s)`,
      );
    } catch (e) {
      setPhase("error");
      toast.error(e instanceof Error ? e.message : "Erro na importação.");
    } finally {
      setLoading(false);
      setCurrentFile(null);
    }
  };

  const phaseLabel: Record<Phase, string> = {
    idle: "",
    parse: "A ler e a detetar cabeçalhos…",
    processing: "A interpretar e a gravar procuras…",
    finalizing: "A cruzar com a carteira…",
    done: "Concluído",
    error: "Erro",
  };
  const progressPct =
    phase === "finalizing" || phase === "done"
      ? 100
      : total > 0
        ? Math.min(100, Math.round((processed / total) * 100))
        : 0;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-secondary text-primary inline-flex items-center justify-center shrink-0">
          <FileSpreadsheet className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Importar Procuras</h1>
          <p className="text-muted-foreground mt-1">
            Carrega um ou vários Excel de compradores de uma só vez. Cada linha vira uma Procura Ativa e cruza
            imediatamente com a carteira. Procuras já existentes são <strong>atualizadas</strong>{" "}
            e as que deixarem de constar do novo ficheiro são <strong>removidas</strong> — sem
            duplicados.
          </p>
        </div>
      </div>

      <Card className="p-6 space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          multiple
          onChange={(e) => {
            setFiles(Array.from(e.target.files ?? []));
          }}
        />
        <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
          <FileSpreadsheet className="w-10 h-10 mx-auto text-muted-foreground" />
          <div>
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" />
              {files.length > 0 ? "Escolher outros ficheiros" : "Escolher Excel (pode escolher vários)"}
            </Button>
          </div>
          {files.length > 0 && (
            <ul className="text-sm text-muted-foreground space-y-1">
              {files.map((f) => (
                <li key={f.name}>
                  <strong>{f.name}</strong> · {(f.size / 1024).toFixed(0)} KB
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button onClick={submit} disabled={files.length === 0 || loading} size="lg" className="w-full">
          {loading ? "A importar e a cruzar..." : "Importar e cruzar com a carteira"}
        </Button>

        {loading && (
          <div className="space-y-2">
            <Progress value={progressPct} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {phaseLabel[phase]}
                {currentFile ? ` — ${currentFile}` : ""}
              </span>
              <span className="tabular-nums">
                {phase === "processing" || phase === "finalizing" || phase === "done"
                  ? `${processed}/${total} · ${progressPct}%`
                  : ""}
              </span>
            </div>
            {(phase === "processing" || phase === "finalizing") && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <MiniStat label="Novas" value={running.novas} />
                <MiniStat label="Atualizadas" value={running.atualizadas} />
                <MiniStat label="Ignoradas" value={running.ignoradas_sem_contacto} />
                <MiniStat label="Erros" value={running.erros} />
              </div>
            )}
            {headerRow != null && headerRow > 1 && (
              <p className="text-xs text-muted-foreground">
                Cabeçalhos detetados na linha {headerRow}.
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Procuras importadas via Excel expiram automaticamente ao fim de 30 dias, salvo se
          voltarem no ficheiro seguinte.
        </p>
      </Card>

      {result && (
        <>
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-700 font-semibold">
              <CheckCircle2 className="w-5 h-5" /> Importação concluída
            </div>
            <div className="text-sm">
              <strong>{result.analisadas}</strong> linha(s) analisada(s) em{" "}
              <strong>{files.length}</strong> ficheiro(s)
              {elapsedMs > 0 && (
                <span className="text-muted-foreground"> · {(elapsedMs / 1000).toFixed(1)}s</span>
              )}
              {headerRow != null && headerRow > 1 && (
                <span className="text-muted-foreground"> · cabeçalhos na linha {headerRow}</span>
              )}
              {!result.total_check && (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-700 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Contabilização inconsistente — verificar logs
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <SummaryStat label="Novas" value={result.novas} />
              <SummaryStat label="Atualizadas" value={result.atualizadas} />
              <SummaryStat label="Duplicados exatos" value={result.duplicados_exatos_fundidos} />
              <SummaryStat label="Mantidas separadas" value={result.mantidas_separadas} />
              <SummaryStat label="Revisão" value={result.sinalizadas_revisao} />
              <SummaryStat label="Ignoradas" value={result.ignoradas_sem_contacto} />
              <SummaryStat label="Descartadas" value={result.descartadas_anuncio} />
              <SummaryStat label="Erros" value={result.erros} highlight={result.erros > 0} />
            </div>
            <p className="text-xs text-muted-foreground">
              {result.matches} Match(es) encontrado(s) na carteira. Vê as procuras — incluindo as marcadas para revisão — no <strong>Radar</strong>.
            </p>
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h2 className="font-semibold">Relatório linha-a-linha</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Uma classificação final por cada linha do ficheiro.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Ficheiro</th>
                    <th className="text-left px-4 py-2">Linha</th>
                    <th className="text-left px-4 py-2">Comprador</th>
                    <th className="text-left px-4 py-2">Consultor</th>
                    <th className="text-left px-4 py-2">Resultado</th>
                    <th className="text-left px-4 py-2">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {result.linhas.map((r) => (
                    <tr key={`${r.ficheiro}-${r.linha}`} className="border-t">
                      <td className="px-4 py-2 text-xs text-muted-foreground">{r.ficheiro}</td>
                      <td className="px-4 py-2 tabular-nums">{r.linha}</td>
                      <td className="px-4 py-2">{r.comprador ?? "—"}</td>
                      <td className="px-4 py-2">{r.consultor ?? "—"}</td>
                      <td className="px-4 py-2">
                        <ResultBadge resultado={r.resultado} />
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{r.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-2 py-1">
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        highlight ? "border-destructive/40 bg-destructive/5" : ""
      }`}
    >
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

type LineResult = ExcelImportResult["linhas"][number]["resultado"];

function ResultBadge({ resultado }: { resultado: LineResult }) {
  const styles: Record<LineResult, string> = {
    Nova: "bg-emerald-100 text-emerald-800",
    Atualizada: "bg-blue-100 text-blue-800",
    "Duplicado exato": "bg-slate-100 text-slate-800",
    Revisão: "bg-amber-100 text-amber-800",
    Separada: "bg-indigo-100 text-indigo-800",
    Ignorada: "bg-muted text-muted-foreground",
    Descartada: "bg-muted text-muted-foreground",
    Erro: "bg-red-100 text-red-800",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[resultado]}`}
    >
      {resultado}
    </span>
  );
}
