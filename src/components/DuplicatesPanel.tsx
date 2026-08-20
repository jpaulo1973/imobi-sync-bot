import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Copy, RefreshCw, Merge, Split } from "lucide-react";
import { toast } from "sonner";
import {
  listDuplicateGroups,
  mergeDuplicateGroup,
  keepDuplicateGroupSeparate,
  simulateMergeDuplicateGroup,
  type DuplicateGroup,
  type MergePreview,
} from "@/lib/duplicates.functions";

/**
 * Painel de Duplicados (Manutenção) — revisão manual dos duplicados já
 * existentes. A fusão é sempre explícita: o administrador escolhe o registo a
 * manter. Nada é fundido automaticamente aqui.
 */
export function DuplicatesPanel() {
  const listFn = useServerFn(listDuplicateGroups);
  const mergeFn = useServerFn(mergeDuplicateGroup);
  const simulateFn = useServerFn(simulateMergeDuplicateGroup);
  const keepFn = useServerFn(keepDuplicateGroupSeparate);
  const [grupos, setGrupos] = useState<DuplicateGroup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [preview, setPreview] = useState<{ grupo: DuplicateGroup; keepId: string; dados: MergePreview } | null>(
    null,
  );
  const [applying, setApplying] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listFn();
      setGrupos(r.grupos);
      setTotal(r.total_excedentes);
      setKeep(Object.fromEntries(r.grupos.map((g) => [g.key, g.membros[0]!.id])));
      setSelected(Object.fromEntries(r.grupos.map((g) => [g.key, g.membros.map((m) => m.id)])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar duplicados");
    } finally {
      setLoading(false);
    }
  };

  const selectedOf = (g: DuplicateGroup) => selected[g.key] ?? g.membros.map((m) => m.id);
  const keepOf = (g: DuplicateGroup) => {
    const sel = selectedOf(g);
    const k = keep[g.key];
    return k && sel.includes(k) ? k : (sel[0] ?? g.membros[0]!.id);
  };

  const removeIdsOf = (g: DuplicateGroup, keepId: string) =>
    selectedOf(g).filter((id) => id !== keepId);

  /** Alterna a inclusão de um membro na fusão; o "fica" salta se for desmarcado. */
  const toggleMember = (g: DuplicateGroup, id: string) => {
    const sel = selectedOf(g);
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    setSelected((p) => ({ ...p, [g.key]: next }));
    if (!next.includes(keepOf(g))) {
      setKeep((p) => ({ ...p, [g.key]: next[0] ?? "" }));
    }
  };

  /** Passo 1 — simular: nada é gravado, só mostramos o impacto. */
  const simular = async (g: DuplicateGroup) => {
    const keepId = keepOf(g);
    const removeIds = removeIdsOf(g, keepId);
    if (removeIds.length === 0) return;
    setBusy(g.key);
    try {
      const dados = await simulateFn({
        data: { keep_id: keepId, remove_ids: removeIds },
      });
      setPreview({ grupo: g, keepId, dados });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao simular fusão");
    } finally {
      setBusy(null);
    }
  };

  /** Passo 2 — aplicar, apenas após confirmação explícita. */
  const aplicar = async () => {
    if (!preview) return;
    const { grupo, keepId } = preview;
    const removeIds = removeIdsOf(grupo, keepId);
    setApplying(true);
    try {
      const r = await mergeFn({
        data: { keep_id: keepId, remove_ids: removeIds },
      });
      toast.success(`${r.removidas} procura(s) apagada(s); mantida a escolhida.`);
      // Fusão parcial: o grupo mantém-se com a mantida + as procuras não incluídas.
      const apagados = new Set(removeIds);
      setGrupos((prev) =>
        (prev ?? []).flatMap((x) => {
          if (x.key !== grupo.key) return [x];
          const membros = x.membros.filter((m) => !apagados.has(m.id));
          if (membros.length < 2) return [];
          return [{ ...x, membros, excedentes: membros.length - 1 }];
        }),
      );
      setSelected((p) => ({
        ...p,
        [grupo.key]: (p[grupo.key] ?? []).filter((id) => !apagados.has(id)),
      }));
      setTotal((t) => Math.max(0, t - r.removidas));
      setPreview(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao fundir");
    } finally {
      setApplying(false);
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
              <Button size="sm" disabled={busy === g.key} onClick={() => simular(g)}>
                <Merge className="w-4 h-4 mr-1" />
                {busy === g.key ? "A simular…" : "Fundir no selecionado"}
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

      <AlertDialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar fusão — ação definitiva</AlertDialogTitle>
            <AlertDialogDescription>
              Fica apenas a procura selecionada. As restantes são apagadas em definitivo, sem
              possibilidade de recuperação. Nada foi gravado até aqui.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {preview && (
            <div className="space-y-3 text-sm">
              <p>
                Mantida: <span className="font-medium">{preview.dados.mantida.nome ?? "(sem nome)"}</span>{" "}
                <Badge variant="outline">{preview.dados.mantida.origem ?? "—"}</Badge>
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="border rounded-md p-2">
                  <div className="text-xs text-muted-foreground">Procuras apagadas</div>
                  <div className="text-lg font-semibold">{preview.dados.remover}</div>
                </div>
                <div className="border rounded-md p-2">
                  <div className="text-xs text-muted-foreground">Oportunidades</div>
                  <div className="text-lg font-semibold">{preview.dados.oportunidades_removidas}</div>
                </div>
                <div className="border rounded-md p-2">
                  <div className="text-xs text-muted-foreground">Notificações</div>
                  <div className="text-lg font-semibold">{preview.dados.notificacoes_removidas}</div>
                </div>
                <div className="border rounded-md p-2">
                  <div className="text-xs text-muted-foreground">Estados de match</div>
                  <div className="text-lg font-semibold">{preview.dados.estados_removidos}</div>
                </div>
              </div>
              <div className="max-h-56 overflow-auto border rounded-md divide-y">
                {preview.dados.amostra.map((a) => (
                  <div key={a.id} className="p-2 text-xs">
                    <span className="font-medium">{a.nome ?? "(sem nome)"}</span> · {a.origem ?? "—"} ·{" "}
                    {a.criada_em ?? "—"} · {a.oportunidades} oportunidade(s) · {a.notificacoes}{" "}
                    notificação(ões) · {a.estados} estado(s)
                  </div>
                ))}
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void aplicar();
              }}
              disabled={applying}
            >
              {applying ? "A fundir…" : "Fundir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
