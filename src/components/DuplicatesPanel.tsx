import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, RefreshCw, Merge, Split } from "lucide-react";
import { toast } from "sonner";
import {
  listDuplicateGroups,
  mergeDuplicateGroup,
  keepDuplicateGroupSeparate,
  type DuplicateGroup,
} from "@/lib/duplicates.functions";

/**
 * Painel de Duplicados (Manutenção) — revisão manual dos duplicados já
 * existentes. A fusão é sempre explícita: o administrador escolhe o registo a
 * manter. Nada é fundido automaticamente aqui.
 */
export function DuplicatesPanel() {
  const listFn = useServerFn(listDuplicateGroups);
  const mergeFn = useServerFn(mergeDuplicateGroup);
  const keepFn = useServerFn(keepDuplicateGroupSeparate);
  const [grupos, setGrupos] = useState<DuplicateGroup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [keep, setKeep] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const r = await listFn();
      setGrupos(r.grupos);
      setTotal(r.total_excedentes);
      setKeep(Object.fromEntries(r.grupos.map((g) => [g.key, g.membros[0]!.id])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar duplicados");
    } finally {
      setLoading(false);
    }
  };

  const fundir = async (g: DuplicateGroup) => {
    const keepId = keep[g.key] ?? g.membros[0]!.id;
    setBusy(g.key);
    try {
      const r = await mergeFn({
        data: { keep_id: keepId, remove_ids: g.membros.map((m) => m.id).filter((id) => id !== keepId) },
      });
      toast.success(`${r.removidas} procura(s) removida(s); mantida a escolhida.`);
      setGrupos((prev) => (prev ?? []).filter((x) => x.key !== g.key));
      setTotal((t) => Math.max(0, t - r.removidas));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao fundir");
    } finally {
      setBusy(null);
    }
  };

  const manterSeparado = async (g: DuplicateGroup) => {
    setBusy(g.key);
    try {
      await keepFn({ data: { key: g.key } });
      setGrupos((prev) => (prev ?? []).filter((x) => x.key !== g.key));
      toast.success("Grupo marcado como legítimo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Copy className="w-5 h-5" /> Duplicados existentes
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Procuras da mesma pessoa criadas antes do reforço da deduplicação. Escolha
            qual manter — nada é fundido sem a sua confirmação.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          {grupos ? "Recarregar" : "Analisar"}
        </Button>
      </div>

      {grupos && (
        <p className="text-sm">
          <Badge variant="secondary">{grupos.length} grupo(s)</Badge>{" "}
          <span className="text-muted-foreground">{total} procura(s) excedente(s)</span>
        </p>
      )}

      {grupos?.length === 0 && (
        <p className="text-sm text-muted-foreground">Sem duplicados por revisar.</p>
      )}

      <div className="space-y-3">
        {(grupos ?? []).map((g) => (
          <div key={g.key} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{g.pessoa}</span>
              {g.telefone && <Badge variant="outline">{g.telefone}</Badge>}
              <Badge variant="secondary">
                {g.chave_tipo === "telefone" ? "por telefone" : "por nome (sem telefone)"}
              </Badge>
              <Badge variant="outline">texto ~{Math.round(g.similaridade_texto * 100)}%</Badge>
              <Badge>{g.excedentes} excedente(s)</Badge>
            </div>

            <div className="space-y-2">
              {g.membros.map((m) => (
                <label
                  key={m.id}
                  className="flex items-start gap-3 text-sm p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                >
                  <input
                    type="radio"
                    className="mt-1"
                    name={`keep-${g.key}`}
                    checked={(keep[g.key] ?? g.membros[0]!.id) === m.id}
                    onChange={() => setKeep((p) => ({ ...p, [g.key]: m.id }))}
                  />
                  <span className="space-y-1">
                    <span className="block text-xs text-muted-foreground">
                      {new Date(m.created_at).toLocaleString("pt-PT")} · {m.origem ?? "—"} ·
                      completude {m.completeness} · {m.matches_count} match(es)
                    </span>
                    <span className="block line-clamp-2">
                      {m.texto_original ?? m.resumo ?? "(sem texto)"}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" disabled={busy === g.key} onClick={() => fundir(g)}>
                <Merge className="w-4 h-4 mr-1" /> Fundir no selecionado
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === g.key}
                onClick={() => manterSeparado(g)}
              >
                <Split className="w-4 h-4 mr-1" /> Manter separadas
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
