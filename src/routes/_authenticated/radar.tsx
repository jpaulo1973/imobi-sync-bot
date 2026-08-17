import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Radar, Trash2, Sparkles, ArrowRight, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { PhoneButton } from "@/components/PhoneButton";
import { OriginalMessage } from "@/components/OriginalMessage";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  countBuyerOpportunities,
} from "@/lib/buyer-opportunities.functions";

export const Route = createFileRoute("/_authenticated/radar")({
  // Notificações de Procura WhatsApp: `?procura=<id>&property=<id>` abre
  // directamente essa procura (foco + detalhe da oportunidade).
  validateSearch: (search: Record<string, unknown>): { procura?: string; property?: string } => ({
    procura: typeof search.procura === "string" ? search.procura : undefined,
    property: typeof search.property === "string" ? search.property : undefined,
  }),
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
    tipo_imovel?: string | null;
    zona?: string | null;
    municipio?: string | null;
    freguesia?: string | null;
    concelho?: string | null;
    distrito?: string | null;
    budget_min?: number | null;
    budget_max?: number | null;
  };
  tipo_imovel?: string | null;
  zona?: string | null;
  resumo: string | null;
  texto_original?: string | null;
  notas?: string | null;
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

const TIPOS_IMOVEL = [
  "Apartamento",
  "Moradia",
  "Terreno",
  "Loja",
  "Escritório",
  "Armazém",
  "Prédio",
  "Espaço comercial",
];

type SortKey = "recentes" | "budget_desc" | "budget_asc" | "expira";

function stateKey(days: number): "ativa" | "breve" | "expirada" {
  if (days <= 0) return "expirada";
  if (days <= 3) return "breve";
  return "ativa";
}

function normalize(v: string) {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function RadarPage() {
  const urlParams = Route.useSearch();
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
  // Correções 1.3: abrir uma oportunidade mostra o detalhe num Sheet inline,
  // sem sair do Radar.
  const [openOpp, setOpenOpp] = useState<any | null>(null);
  // Notificação de Procura WhatsApp: painel lateral dedicado com a procura
  // completa (critérios, mensagem original, contactos e imóveis compatíveis).
  const [openSearch, setOpenSearch] = useState<Row | null>(null);
  // Filtros e ordenação (client-side, sobre as procuras já carregadas).
  const [fTipo, setFTipo] = useState<string>("todos");
  const [fZona, setFZona] = useState<string>("");
  const [fMin, setFMin] = useState<string>("");
  const [fMax, setFMax] = useState<string>("");
  const [fEstado, setFEstado] = useState<string>("todas");
  const [sort, setSort] = useState<SortKey>("recentes");
  // Procura vinda de uma notificação: fica em foco e é aberta directamente.
  const [focusSearchId, setFocusSearchId] = useState<string | null>(null);
  // Guarda o último alvo (procura+imóvel) já tratado, para que cada notificação
  // diferente volte a accionar foco/scroll/abertura sem recarregar a página.
  const handledTarget = useState<{ key: string | null }>({ key: null })[0];

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

  // Ao chegar de uma notificação: limpar filtros (para o cartão nunca ficar
  // escondido), abrir o detalhe da oportunidade correspondente e fazer scroll
  // até ao cartão da procura.
  useEffect(() => {
    const procuraId = urlParams.procura;
    if (!procuraId || loading) return;
    const key = `${procuraId}|${urlParams.property ?? ""}`;
    if (handledTarget.key === key) return;
    handledTarget.key = key;
    setFTipo("todos");
    setFZona("");
    setFMin("");
    setFMax("");
    setFEstado("todas");
    setFocusSearchId(procuraId);
    const opp =
      opps.find(
        (o) =>
          o.active_search_id === procuraId &&
          (!urlParams.property || o.property_id === urlParams.property),
      ) ?? opps.find((o) => o.active_search_id === procuraId);
    const row = rows.find((r) => r.id === procuraId) ?? null;
    if (row) {
      // Abre a procura em detalhe (não apenas o par imóvel↔procura).
      setOpenSearch(row);
    } else if (opp) {
      setOpenOpp(opp);
    } else {
      toast.warning("Procura não encontrada — pode ter expirado ou pertencer a outro grupo.");
      return;
    }
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-search-id="${procuraId}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [urlParams.procura, urlParams.property, loading, opps, rows, handledTarget]);

  const remove = async (id: string) => {
    try {
      await delFn({ data: { id } });
      setRows((r) => r.filter((x) => x.id !== id));
      toast.success("Procura removida.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover.");
    }
  };

  const visibleRows = useMemo(() => {
    const min = fMin.trim() === "" ? null : Number(fMin);
    const max = fMax.trim() === "" ? null : Number(fMax);
    const zonaQ = normalize(fZona.trim());

    const filtered = rows.filter((r) => {
      const c = r.criteria ?? {};
      if (fTipo !== "todos") {
        const tipo = normalize(String(c.tipo_imovel ?? r.tipo_imovel ?? ""));
        if (!tipo || !tipo.includes(normalize(fTipo))) return false;
      }
      if (zonaQ) {
        const hay = normalize(
          [c.zona, c.municipio, c.freguesia, c.concelho, c.distrito, r.zona, r.resumo]
            .filter(Boolean)
            .join(" "),
        );
        if (!hay.includes(zonaQ)) return false;
      }
      const bMax = c.budget_max ?? null;
      const bMin = c.budget_min ?? null;
      if (min != null && !Number.isNaN(min)) {
        const ref = bMax ?? bMin;
        if (ref == null || ref < min) return false;
      }
      if (max != null && !Number.isNaN(max)) {
        const ref = bMin ?? bMax;
        if (ref == null || ref > max) return false;
      }
      if (fEstado !== "todas" && stateKey(daysLeft(r.expires_at)) !== fEstado) return false;
      return true;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "recentes") {
        return (
          new Date(b.data_publicacao ?? b.created_at).getTime() -
          new Date(a.data_publicacao ?? a.created_at).getTime()
        );
      }
      if (sort === "expira") {
        return daysLeft(a.expires_at) - daysLeft(b.expires_at);
      }
      const av = a.criteria?.budget_max ?? a.criteria?.budget_min ?? null;
      const bv = b.criteria?.budget_max ?? b.criteria?.budget_min ?? null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sort === "budget_desc" ? bv - av : av - bv;
    });
    return sorted;
  }, [rows, fTipo, fZona, fMin, fMax, fEstado, sort]);

  const filtersActive =
    fTipo !== "todos" || fZona.trim() !== "" || fMin !== "" || fMax !== "" || fEstado !== "todas";

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
                        <Button size="sm" variant="outline" onClick={() => setOpenOpp(o)}>
                          Abrir <ArrowRight className="w-3 h-3 ml-1" />
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

          {rows.length > 0 && (
            <Card className="p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Tipo de imóvel</label>
                  <Select value={fTipo} onValueChange={setFTipo}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      {TIPOS_IMOVEL.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Zona / localização</label>
                  <Input
                    value={fZona}
                    onChange={(e) => setFZona(e.target.value)}
                    placeholder="ex: Lisboa"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Estado</label>
                  <Select value={fEstado} onValueChange={setFEstado}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas</SelectItem>
                      <SelectItem value="ativa">Ativa</SelectItem>
                      <SelectItem value="breve">Expira em breve</SelectItem>
                      <SelectItem value="expirada">Expirada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Orçamento mínimo</label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={fMin}
                    onChange={(e) => setFMin(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Orçamento máximo</label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={fMax}
                    onChange={(e) => setFMax(e.target.value)}
                    placeholder="sem limite"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Ordenar por</label>
                  <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recentes">Mais recentes primeiro</SelectItem>
                      <SelectItem value="budget_desc">Orçamento: maior para menor</SelectItem>
                      <SelectItem value="budget_asc">Orçamento: menor para maior</SelectItem>
                      <SelectItem value="expira">Expira em breve primeiro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {visibleRows.length} de {rows.length} procura(s)
                </span>
                {filtersActive && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setFTipo("todos");
                      setFZona("");
                      setFMin("");
                      setFMax("");
                      setFEstado("todas");
                    }}
                  >
                    Limpar filtros
                  </Button>
                )}
              </div>
            </Card>
          )}

          {rows.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          Sem procuras ativas no momento. Podes ativar uma procura no final de cada análise em{" "}
          <strong>Match WhatsApp</strong> quando não existirem imóveis compatíveis.
        </Card>
      ) : visibleRows.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          Nenhuma procura corresponde aos filtros aplicados.
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleRows.map((r) => {
            const days = daysLeft(r.expires_at);
            const st = stateBadge(days);
            const tel = r.contact_telefone?.replace(/\s+/g, "");
            const focused = focusSearchId === r.id;
            return (
              <Card
                key={r.id}
                data-search-id={r.id}
                className={
                  "p-4 space-y-3 " + (focused ? "ring-2 ring-primary border-primary" : "")
                }
              >
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

      <Sheet open={!!openOpp} onOpenChange={(v) => !v && setOpenOpp(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {openOpp && (() => {
            const p = openOpp.properties ?? {};
            const s = openOpp.active_searches ?? {};
            return (
              <>
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" /> Detalhe da oportunidade
                  </SheetTitle>
                  <SheetDescription>
                    Compatibilidade <strong>{openOpp.score}%</strong> entre o imóvel e a procura.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-4 space-y-4 text-sm">
                  <Card className="p-3 space-y-1">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Imóvel</div>
                    <div className="font-medium">
                      {p.tipologia ? `${p.tipologia} · ` : ""}
                      {p.zona ?? p.freguesia ?? p.concelho ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.tipo_imovel ?? "—"}
                      {p.preco ? ` · ${euros(p.preco)}` : ""}
                      {p.referencia ? ` · Ref: ${p.referencia}` : ""}
                    </div>
                  </Card>
                  <Card className="p-3 space-y-1">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Comprador</div>
                    <div className="font-medium">
                      {s.contact_nome ?? s.contact_telefone ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.criteria?.tipologia ? `${s.criteria.tipologia} · ` : ""}
                      {s.criteria?.zona ?? "—"}
                      {s.criteria?.budget_max ? ` · até ${euros(s.criteria.budget_max)}` : ""}
                    </div>
                    {s.resumo && (
                      <p className="text-xs italic text-muted-foreground mt-1">"{s.resumo}"</p>
                    )}
                  </Card>
                  {Array.isArray(openOpp.reasons) && openOpp.reasons.length > 0 && (
                    <Card className="p-3 space-y-1">
                      <div className="text-xs font-semibold uppercase text-muted-foreground">
                        Razões do match
                      </div>
                      <ul className="text-xs list-disc pl-4 space-y-0.5">
                        {openOpp.reasons.map((r: string, i: number) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </Card>
                  )}
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}