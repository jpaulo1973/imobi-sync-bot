// Painel de administração: semeia `contacts` a partir do histórico de
// procuras. Só grava nomes com UM telefone distinto; os ambíguos aparecem
// listados para decisão manual (Revisão → telefone novo).

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Contact, PlayCircle, FlaskConical } from "lucide-react";
import type { ContactsBackfillResult } from "@/lib/contacts-backfill.functions";

type Props = {
  result: ContactsBackfillResult | null;
  loading: "dry" | "apply" | null;
  onRun: (dryRun: boolean) => void;
};

export function ContactsBackfillPanel({ result, loading, onRun }: Props) {
  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Contact className="w-5 h-5 text-primary" />
          Semear contactos do histórico
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Percorre todas as procuras e grava os pares (nome, telefone) na tabela de contactos,
          para que importações futuras sem número os preencham automaticamente. Só semeia nomes
          com <strong>um único telefone</strong> em todo o histórico — nomes com vários números
          nunca são resolvidos automaticamente e ficam listados em baixo para decisão manual.
          Não altera nenhuma procura.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={loading !== null} onClick={() => onRun(true)}>
          <FlaskConical className="w-4 h-4 mr-2" />
          {loading === "dry" ? "A simular…" : "Simular (não grava)"}
        </Button>
        <Button disabled={loading !== null} onClick={() => onRun(false)}>
          <PlayCircle className="w-4 h-4 mr-2" />
          {loading === "apply" ? "A semear…" : "Semear contactos"}
        </Button>
      </div>

      {result && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold">
              {result.dry_run ? "Simulação (nada gravado)" : "Backfill aplicado"}
            </span>
            <Badge variant="outline">{result.linhas_lidas} procuras lidas</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat label="Nomes distintos" value={result.nomes_distintos} />
            <Stat label="Pares elegíveis" value={result.pares_elegiveis} />
            <Stat label="Linhas ignoradas" value={result.linhas_ignoradas} />
            <Stat label="Semeados" value={result.semeados} />
            <Stat label="Reforçados" value={result.reforcados} />
            <Stat label="Nomes ambíguos" value={result.nomes_ambiguos} />
          </div>

          {result.ambiguos.length > 0 && (
            <div className="space-y-2">
              <div className="font-medium">
                Nomes ambíguos — nada gravado, decidir caso a caso na Revisão
              </div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto border rounded">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Nome</th>
                      <th className="text-left px-2 py-1">Telefones (nº procuras)</th>
                      <th className="text-left px-2 py-1">Pistas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.ambiguos.map((a) => (
                      <tr key={a.nome_normalizado} className="border-t align-top">
                        <td className="px-2 py-1">
                          <div className="font-medium">{a.nomes_display.join(" / ")}</div>
                          <code className="text-muted-foreground">{a.nome_normalizado}</code>
                        </td>
                        <td className="px-2 py-1">
                          {a.telefones.slice(0, 8).map((t) => (
                            <div key={t.telefone} className="tabular-nums">
                              {t.telefone} ({t.procuras})
                            </div>
                          ))}
                          {a.telefones.length > 8 && (
                            <div className="text-muted-foreground">
                              +{a.telefones.length - 8} outros números
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {a.telefones.length > 10
                            ? "Rótulo genérico — muitas pessoas diferentes"
                            : [...new Set(a.telefones.flatMap((t) => t.emails))].length > 1
                              ? `Emails distintos: ${[...new Set(a.telefones.flatMap((t) => t.emails))].join(", ")}`
                              : `${a.telefones[0]?.primeira?.slice(0, 10)} → ${a.telefones[0]?.ultima?.slice(0, 10)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-background px-2 py-1">
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}