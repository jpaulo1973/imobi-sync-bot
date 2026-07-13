import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listActiveSearches,
  deleteActiveSearch,
  listOpportunities,
  markOpportunitiesViewed,
} from "@/lib/active-searches.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Radar, Trash2, Sparkles, ArrowRight, Users } from "lucide-react";
import { toast } from "sonner";
import { PhoneButton } from "@/components/PhoneButton";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  countBuyerOpportunities,
} from "@/lib/buyer-opportunities.functions";

export const Route = createFileRoute("/_authenticated/radar")({
  head: () => ({
    meta: [
      { title: "Radar de Procuras Ativas — Property Match" },
      {
        name: "description",
        content:
          "Procuras recentes recebidas via WhatsApp que continuam a ser comparadas automaticamente com novos imóveis da carteira.",
      },
    ],
  }),
  component: RadarPage,
});

type Row = {
  id: string;
  criteria: {
    finalidade?: string | null;
    tipologia?: string | null;
    zona?: string | null;
    budget_max?: number | null;
  };
  resumo: string | null;
  contact_nome: string | null;
  contact_telefone: string | null;
  contact_grupo: string | null;
  data_publicacao: string | null;
  created_at: string;
  expires_at: string;
  origem?: string | null;
  updated_at?: string | null;
  last_match_at?: string | null;
  flagged_for_review?: boolean | null;
  similarity_score?: number | null;
  decision_reason?: string | null;
};

function euros(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function daysLeft(expires_at: string) {
  const ms = new Date(expires_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function stateBadge(days: number) {
  if (days <= 0) return { label: "Expirada", cls: "bg-slate-100 text-slate-700 border-slate-200" };
  if (days <= 3) return { label: "Expira em breve", cls: "bg-amber-100 text-amber-800 border-amber-200" };
  return { label: "Ativa", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" };
}

function RadarPage() {
  const listFn = useServerFn(listActiveSearches);
  const delFn = useServerFn(deleteActiveSearch);
  const oppsFn = useServerFn(listOpportunities);
  const markFn = useServerFn(markOpportunitiesViewed);
  const buyerCountsFn = useServerFn(countBuyerOpportunities);
  const [rows, setRows] = useState<Row[]>([]);
  const [opps, setOpps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [buyers, setBuyers] = useState<Array<Tables<"buyer_clients">>>([]);
  const [buyerCounts, setBuyerCounts] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [res, oppsRes] = await Promise.all([listFn(), oppsFn()]);
      setRows(res.searches as Row[]);
      setOpps(oppsRes.opportunities as any[]);
      // Ao abrir Radar, as oportunidades passam a "vistas".
      await markFn();
      // Bloco "Os meus compradores".
      const { data: myBuyers } = await supabase
        .from("buyer_clients")
        .select("*")
        .eq("ativo", true)
        .order("created_at", { ascending: false });
      setBuyers(myBuyers ?? []);
      try {
        const bc = await buyerCountsFn();
        setBuyerCounts(bc.counts ?? {});
      } catch (e) {
        console.error(e);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar procuras.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (id: string) => {
    try {
      await delFn({ data: { id } });
      setRows((r) => r.filter((x) => x.id !== id));
      toast.success("Procura removida.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover.");
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-secondary text-primary inline-flex items-center justify-center shrink-0">
          <Radar className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Radar de Procuras Ativas</h1>
          <p className="text-muted-foreground mt-1">
            Procuras recentes recebidas via WhatsApp. Cada novo imóvel adicionado à carteira é
            automaticamente comparado com estas procuras. Após o prazo definido, são apagadas.
          </p>
        </div>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-muted-foreground">A carregar...</Card>
      ) : (
        <>
          {opps.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <h2 className="text-lg font-semibold">Novas Oportunidades ({opps.length})</h2>
              </div>
              <div className="grid gap-2">
                {opps.slice(0, 20).map((o) => {
                  const p = o.properties ?? {};
                  const s = o.active_searches ?? {};
                  const isNew = !o.viewed_at;
                  return (
                    <Card key={o.id} className={`p-3 flex items-center gap-3 flex-wrap ${isNew ? "border-primary/40 bg-primary/5" : ""}`}>
                      <Badge variant="default">{o.score}%</Badge>
                      <div className="text-sm min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {p.tipologia ? `${p.tipologia} · ` : ""}
                          {p.zona ?? p.freguesia ?? p.concelho ?? "Imóvel"}
                          {p.preco ? ` · ${euros(p.preco)}` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          Comprador: {s.contact_nome ?? s.contact_telefone ?? "—"}
                          {s.criteria?.zona ? ` · ${s.criteria.zona}` : ""}
                          {s.criteria?.budget_max ? ` · até ${euros(s.criteria.budget_max)}` : ""}
                        </div>
                      </div>
                      {p.id && (
                        <Button asChild size="sm" variant="outline">
                          <Link to="/imoveis" search={{ open: p.id }}>
                            Abrir <ArrowRight className="w-3 h-3 ml-1" />
                          </Link>
                        </Button>
                      )}
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {buyers.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                <h2 className="text-lg font-semibold">Os meus compradores ({buyers.length})</h2>
              </div>
              <div className="grid gap-2">
                {buyers.slice(0, 20).map((b) => {
                  const n = buyerCounts[b.id] ?? 0;
                  return (
                    <Card key={b.id} className={`p-3 flex items-center gap-3 flex-wrap ${n > 0 ? "border-primary/40 bg-primary/5" : ""}`}>
                      {n > 0 && <Badge variant="default">{n} imóveis</Badge>}
                      <div className="text-sm min-w-0 flex-1">
                        <div className="font-medium truncate">{b.nome}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {b.finalidade === "venda" ? "Comprar" : "Arrendar"}
                          {b.tipologia ? ` · ${b.tipologia}` : ""}
                          {b.zona ? ` · ${b.zona}` : ""}
                          {b.budget_max ? ` · até ${euros(Number(b.budget_max))}` : ""}
                        </div>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link to="/clientes">
                          Abrir <ArrowRight className="w-3 h-3 ml-1" />
                        </Link>
                      </Button>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {rows.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          Sem procuras ativas no momento. Podes ativar uma procura no final de cada análise em{" "}
          <strong>Match WhatsApp</strong> quando não existirem imóveis compatíveis.
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const days = daysLeft(r.expires_at);
            const st = stateBadge(days);
            const tel = r.contact_telefone?.replace(/\s+/g, "");
            return (
              <Card key={r.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={st.cls} variant="outline">{st.label}</Badge>
                      <Badge variant="outline">{days} dia(s) restantes</Badge>
                      {r.origem && (
                        <Badge variant="outline" className="capitalize">{r.origem}</Badge>
                      )}
                      {r.flagged_for_review && (
                        <Badge
                          variant="outline"
                          className="bg-amber-100 text-amber-800 border-amber-200"
                          title={r.decision_reason ?? "Marcada para revisão manual"}
                        >
                          Revisão manual
                        </Badge>
                      )}
                      {r.criteria.finalidade && (
                        <Badge variant={r.criteria.finalidade === "arrendamento" ? "secondary" : "default"}>
                          {r.criteria.finalidade === "venda" ? "Compra" : r.criteria.finalidade === "arrendamento" ? "Arrendamento" : "Indefinido"}
                        </Badge>
                      )}
                      {r.criteria.tipologia && <Badge variant="outline">{r.criteria.tipologia}</Badge>}
                      {r.criteria.zona && <Badge variant="outline">{r.criteria.zona}</Badge>}
                      {r.criteria.budget_max != null && (
                        <Badge variant="outline">até {euros(r.criteria.budget_max)}</Badge>
                      )}
                    </div>
                    {r.resumo && <p className="text-sm font-medium">{r.resumo}</p>}
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                      <span>Recebida: {new Date(r.data_publicacao ?? r.created_at).toLocaleDateString("pt-PT")}</span>
                      {r.contact_nome && <span>Contacto: {r.contact_nome}</span>}
                      {r.contact_telefone && <span>{r.contact_telefone}</span>}
                      {r.contact_grupo && <span>Grupo: {r.contact_grupo}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {tel && <PhoneButton telefone={tel} />}
                    <Button size="sm" variant="ghost" onClick={() => remove(r.id)} aria-label="Remover procura">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
        </>
      )}
    </div>
  );
}