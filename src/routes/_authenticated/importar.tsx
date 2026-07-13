import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { importSearchesFromExcel, type ExcelImportResult } from "@/lib/excel-import.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/importar")({
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

function ImportarPage() {
  const importFn = useServerFn(importSearchesFromExcel);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExcelImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fileToB64 = (f: File) =>
    new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(f);
    });

  const submit = async () => {
    if (!file) return toast.error("Escolhe um ficheiro Excel primeiro.");
    setLoading(true);
    setResult(null);
    try {
      const b64 = await fileToB64(file);
      const res = await importFn({ data: { fileBase64: b64, filename: file.name } });
      setResult(res);
      toast.success(
        `${res.novas} novas · ${res.atualizadas} atualizadas · ${res.duplicados_exatos_fundidos} duplicados · ${res.sinalizadas_revisao} revisão · ${res.ignoradas_sem_contacto} ignoradas · ${res.descartadas_anuncio} descartadas · ${res.erros} erro(s)`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na importação.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-secondary text-primary inline-flex items-center justify-center shrink-0">
          <FileSpreadsheet className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Importar Procuras</h1>
          <p className="text-muted-foreground mt-1">
            Carrega o teu Excel de compradores. Cada linha vira uma Procura Ativa e cruza
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
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
          }}
        />
        <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
          <FileSpreadsheet className="w-10 h-10 mx-auto text-muted-foreground" />
          <div>
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" />
              {file ? "Escolher outro ficheiro" : "Escolher Excel"}
            </Button>
          </div>
          {file && (
            <p className="text-sm text-muted-foreground">
              <strong>{file.name}</strong> · {(file.size / 1024).toFixed(0)} KB
            </p>
          )}
        </div>

        <Button onClick={submit} disabled={!file || loading} size="lg" className="w-full">
          {loading ? "A importar e a cruzar..." : "Importar e cruzar com a carteira"}
        </Button>

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
              <strong>{result.analisadas}</strong> linha(s) analisada(s)
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
                    <th className="text-left px-4 py-2">Linha</th>
                    <th className="text-left px-4 py-2">Comprador</th>
                    <th className="text-left px-4 py-2">Consultor</th>
                    <th className="text-left px-4 py-2">Resultado</th>
                    <th className="text-left px-4 py-2">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {result.linhas.map((r) => (
                    <tr key={r.linha} className="border-t">
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

function ResultBadge({
  resultado,
}: {
  resultado: ExcelImportResult["linhas"][number]["resultado"];
}) {
  const styles: Record<typeof resultado, string> = {
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
