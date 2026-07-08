import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { importSearchesFromExcel, type ExcelImportResult } from "@/lib/excel-import.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Upload, CheckCircle2 } from "lucide-react";
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
      toast.success(`${res.novas} novas · ${res.atualizadas} atualizadas · ${res.matches} matches`);
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
        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold">
            <CheckCircle2 className="w-5 h-5" /> Importação concluída
          </div>
          <ul className="text-sm space-y-1">
            <li>
              <strong>{result.analisadas}</strong> linha(s) analisada(s)
            </li>
            <li>
              <strong>{result.novas}</strong> nova(s) procura(s)
            </li>
            <li>
              <strong>{result.atualizadas}</strong> procura(s) atualizada(s)
            </li>
            <li>
              <strong>{result.removidas}</strong> procura(s) removida(s) (já não constavam)
            </li>
            <li>
              <strong>{result.matches}</strong> Match(es) encontrado(s) na carteira
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Vê as procuras e os contactos rápidos no <strong>Radar</strong>.
          </p>
        </Card>
      )}
    </div>
  );
}
