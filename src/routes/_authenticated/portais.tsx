import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2, Link2, Sparkles, TrendingDown, ExternalLink, RefreshCw, Euro } from "lucide-react";
import { toast } from "sonner";
import { importListingFromUrl, matchBuyersWithListings } from "@/lib/buyers.functions";

type Listing = Tables<"portal_listings">;
type Buyer = Tables<"buyer_clients">;

export const Route = createFileRoute("/_authenticated/portais")({
  head: () => ({ meta: [{ title: "Portais — Property Match" }] }),
  component: PortaisPage,
});

type MatchResult = {
  buyer: Buyer;
  matches: { listing: Listing; score: number; reasons: string[]; baixaPreco: boolean }[];
};

function PortaisPage() {
  const importFn = useServerFn(importListingFromUrl);
  const matchFn = useServerFn(matchBuyersWithListings);

  const [items, setItems] = useState<Listing[]>([]);
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [results, setResults] = useState<MatchResult[] | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("portal_listings")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setItems(data ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setImporting(true);
    try {
      const r = await importFn({ data: { url: url.trim() } });
      if (r.baixaPreco) toast.success("Baixa de preço detectada!");
      else if (r.novo) toast.success("Anúncio importado");
      else toast.success("Anúncio actualizado");
      setUrl("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar");
    } finally {
      setImporting(false);
    }
  };

  const reimport = async (existingUrl: string) => {
    setImporting(true);
    try {
      const r = await importFn({ data: { url: existingUrl } });
      if (r.baixaPreco) toast.success("Baixa de preço detectada!");
      else toast.success("Verificado");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setImporting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Eliminar este anúncio?")) return;
    const { error } = await supabase.from("portal_listings").delete().eq("id", id);
    if (error) toast.error(error.message);
    else load();
  };

  const runMatch = async () => {
    setMatching(true);
    setResults(null);
    try {
      const r = await matchFn({});
      setResults(r.results as MatchResult[]);
      const total = (r.results as MatchResult[]).reduce((s, x) => s + x.matches.length, 0);
      toast.success(`${total} correspondência(s) encontrada(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setMatching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Anúncios de portais</h1>
        <p className="text-muted-foreground mt-1">Importe anúncios por URL e cruze com os seus clientes compradores.</p>
      </div>

      <Card className="p-5">
        <form onSubmit={handleImport} className="flex gap-2">
          <Input
            placeholder="https://www.idealista.pt/imovel/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={importing}
          />
          <Button type="submit" disabled={importing || !url.trim()}>
            <Link2 className="w-4 h-4 mr-2" />
            {importing ? "A importar..." : "Importar"}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-2">
          Cole o link de um anúncio (Idealista, Imovirtual, Casa Sapo, etc.). Reimportar o mesmo URL actualiza o preço e detecta baixas.
        </p>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{items.length} anúncio(s)</h2>
        <Button onClick={runMatch} disabled={matching || items.length === 0}>
          <Sparkles className="w-4 h-4 mr-2" />
          {matching ? "A calcular..." : "Property Match com clientes"}
        </Button>
      </div>

      {results && (
        <div className="space-y-4">
          {results.length === 0 && <p className="text-muted-foreground">Sem clientes activos.</p>}
          {results.map(({ buyer, matches }) => (
            <Card key={buyer.id} className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold">{buyer.nome}</h3>
                  <p className="text-xs text-muted-foreground">
                    {(buyer.tipo_imovel ?? []).join(", ") || "—"} · {buyer.tipologia ?? "—"} · {buyer.zona ?? "—"} · até {buyer.budget_max ? `${Number(buyer.budget_max).toLocaleString("pt-PT")}€` : "∞"}
                  </p>
                </div>
                <Badge variant={matches.length > 0 ? "default" : "secondary"}>{matches.length} match</Badge>
              </div>
              {matches.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem correspondências.</p>
              ) : (
                <div className="space-y-2">
                  {matches.map((m) => (
                    <div key={m.listing.id} className="border rounded-md p-3 flex justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{m.listing.titulo ?? m.listing.url}</span>
                          {m.baixaPreco && (
                            <Badge variant="destructive" className="gap-1">
                              <TrendingDown className="w-3 h-3" /> Baixa de preço
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {m.listing.preco != null && <span className="font-semibold text-foreground">{Number(m.listing.preco).toLocaleString("pt-PT")}€ </span>}
                          {m.listing.preco_anterior != null && m.baixaPreco && (
                            <span className="line-through mr-2">{Number(m.listing.preco_anterior).toLocaleString("pt-PT")}€</span>
                          )}
                          {[m.listing.tipologia, m.listing.zona, m.listing.area_m2 ? `${m.listing.area_m2}m²` : null].filter(Boolean).join(" · ")}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {m.reasons.map((r, i) => <Badge key={i} variant="outline" className="text-xs">{r}</Badge>)}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <Badge>{m.score}</Badge>
                        <a href={m.listing.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> Abrir
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((l) => {
            const baixa = l.preco_anterior != null && l.preco != null && Number(l.preco) < Number(l.preco_anterior);
            return (
              <Card key={l.id} className="p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">{l.portal}</p>
                    <h3 className="font-semibold truncate">{l.titulo ?? l.url}</h3>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => remove(l.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  {l.preco != null && (
                    <span className="text-xl font-bold text-primary inline-flex items-center gap-1">
                      <Euro className="w-4 h-4" />
                      {Number(l.preco).toLocaleString("pt-PT")}
                    </span>
                  )}
                  {baixa && (
                    <Badge variant="destructive" className="gap-1">
                      <TrendingDown className="w-3 h-3" />
                      {Number(l.preco_anterior).toLocaleString("pt-PT")}€
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {l.tipologia && <Badge variant="outline">{l.tipologia}</Badge>}
                  {l.zona && <Badge variant="outline">{l.zona}</Badge>}
                  {l.area_m2 && <Badge variant="outline">{l.area_m2}m²</Badge>}
                  {l.andar != null && <Badge variant="outline">{l.andar}º</Badge>}
                  {l.tem_garagem && <Badge variant="outline">Garagem</Badge>}
                  {l.tem_elevador && <Badge variant="outline">Elevador</Badge>}
                </div>
                <div className="flex justify-between items-center mt-auto pt-2">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" /> Ver anúncio
                  </a>
                  <Button variant="ghost" size="sm" onClick={() => reimport(l.url)} disabled={importing}>
                    <RefreshCw className="w-3 h-3 mr-1" /> Verificar preço
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}