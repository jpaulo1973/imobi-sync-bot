// Release 1.2.18 — Sugestão de telefones a partir de um ficheiro de contactos
// pessoal (vCard/CSV do Google Contacts). Painel separado do "Reimportar
// ficheiro preenchido": aqui NADA é gravado. O ficheiro é lido no browser e
// nunca sai do dispositivo — só o número que o utilizador confirmar no
// "Guardar" de cada cartão é enviado para o servidor.

import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Contact, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  buildSuggestions,
  parseContactsFile,
  summarizeSuggestions,
  type Suggestion,
} from "@/lib/contacts-file";
import type { ConsultorSemTelefone } from "@/lib/review.functions";

export type SuggestionMap = Map<string, Suggestion>;

export function ContactSuggestPanel({
  items,
  onSuggestions,
  onApply,
}: {
  items: ConsultorSemTelefone[];
  onSuggestions: (map: SuggestionMap) => void;
  onApply?: (s: Suggestion) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [info, setInfo] = useState<{
    contactos: number;
    ignorados: number;
    exatos: number;
    parecidos: number;
    ambiguos: number;
    sem_sugestao: number;
  } | null>(null);
  const [sugestoes, setSugestoes] = useState<Suggestion[] | null>(null);

  const pick = async (f: File | null) => {
    if (!f) return;
    setBusy(true);
    try {
      const parsed = await parseContactsFile(f);
      const s = buildSuggestions(
        items.map((it) => ({
          key: it.key,
          nome: it.nome,
          procuras_afetadas: it.procuras_afetadas,
        })),
        parsed.contactos,
      );
      const resumo = summarizeSuggestions(s);
      setFileName(f.name);
      setInfo({ contactos: parsed.contactos.length, ignorados: parsed.ignorados, ...resumo });
      setSugestoes(s);
      const map: SuggestionMap = new Map(
        s.filter((x) => x.telefone).map((x) => [x.key, x] as const),
      );
      onSuggestions(map);
      toast.success(
        `${parsed.contactos.length} contacto(s) lidos · ${resumo.exatos + resumo.parecidos} sugestão(ões).`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler o ficheiro.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const clear = () => {
    setFileName(null);
    setInfo(null);
    setSugestoes(null);
    onSuggestions(new Map());
  };

  const comSugestao = (sugestoes ?? []).filter(
    (s) => s.status === "exato" || s.status === "parecido",
  );
  const ambiguos = (sugestoes ?? []).filter((s) => s.status === "ambiguo");

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Contact className="w-4 h-4 text-primary" />
          Sugerir telefones a partir de contactos
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Carregue o seu ficheiro de contactos (vCard <code>.vcf</code> ou CSV do Google
          Contacts). O ficheiro é lido apenas neste dispositivo, <strong>não é guardado</strong> em
          lado nenhum, e serve só para <strong>sugerir</strong> números. Nada é gravado: cada
          sugestão só entra na procura quando clicar em “Guardar” no cartão respetivo.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          ref={inputRef}
          type="file"
          accept=".vcf,.csv,text/vcard,text/csv"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0] ?? null)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy || items.length === 0}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="w-4 h-4 mr-1" />
          {busy ? "A ler ficheiro…" : "Sugerir telefones a partir de contactos"}
        </Button>
        {fileName && (
          <>
            <Badge variant="secondary">{fileName}</Badge>
            <Button variant="ghost" size="sm" onClick={clear}>
              <X className="w-4 h-4 mr-1" /> Limpar sugestões
            </Button>
          </>
        )}
      </div>

      {info && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="Contactos lidos" value={info.contactos} />
            <Stat label="Ignorados (sem nome/telefone)" value={info.ignorados} />
            <Stat label="Nome exato" value={info.exatos} />
            <Stat label="Nome parecido (≥ 80%)" value={info.parecidos} />
            <Stat label="Ambíguos" value={info.ambiguos} />
            <Stat label="Sem sugestão" value={info.sem_sugestao} />
          </div>

          {comSugestao.length > 0 && (
            <div className="space-y-1">
              <div className="font-medium">Sugestões (nada gravado)</div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto border rounded">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Nome atual</th>
                      <th className="text-left px-2 py-1">Telefone sugerido</th>
                      <th className="text-left px-2 py-1">Contacto de origem</th>
                      <th className="text-left px-2 py-1">%</th>
                      <th className="text-left px-2 py-1">Procuras</th>
                      <th className="text-right px-2 py-1">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comSugestao.map((s) => (
                      <tr key={s.key} className="border-t">
                        <td className="px-2 py-1">{s.nome_atual ?? "(sem nome)"}</td>
                        <td className="px-2 py-1 font-mono">{s.telefone}</td>
                        <td className="px-2 py-1">{s.contacto_nome}</td>
                        <td className="px-2 py-1 tabular-nums">
                          {Math.round(s.score * 100)}%
                          {s.status === "exato" && (
                            <Badge variant="outline" className="ml-1">
                              exato
                            </Badge>
                          )}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{s.procuras_afetadas}</td>
                        <td className="px-2 py-1 text-right whitespace-nowrap">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => onApply?.(s)}
                          >
                            <Check className="w-3 h-3 mr-1" /> Aplicar sugestão
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

              </div>
              <p className="text-muted-foreground">
                As sugestões aparecem pré-preenchidas no cartão de cada consultor, em baixo.
              </p>
            </div>
          )}

          {ambiguos.length > 0 && (
            <div className="space-y-1">
              <div className="font-medium">Ambíguos — sem sugestão automática</div>
              <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-1">
                {ambiguos.map((s) => (
                  <div key={s.key}>
                    <span className="font-medium">{s.nome_atual ?? "(sem nome)"}</span> —{" "}
                    {s.motivo}
                    {s.candidatos?.length ? ` (${s.candidatos.join(" · ")})` : ""}
                  </div>
                ))}
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
