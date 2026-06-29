import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { extractAndMatch } from "@/lib/match.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, MessageSquare, Target, Euro, MapPin, Phone } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/cruzar")({
  head: () => ({ meta: [{ title: "Cruzar Leads — ImoMatch" }] }),
  component: CruzarPage,
});

type Result = Awaited<ReturnType<typeof extractAndMatch>>["results"][number];

function CruzarPage() {
  const [texto, setTexto] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [totalLeads, setTotalLeads] = useState<number | null>(null);
  const run = useServerFn(extractAndMatch);

  const submit = async () => {
    if (texto.trim().length < 10) {
      toast.error("Cole pelo menos algumas mensagens dos grupos.");
      return;
    }
    setLoading(true);
    try {
      const res = await run({ data: { texto } });
      setResults(res.results);
      setTotalLeads(res.totalLeads);
      if (res.totalLeads === 0) toast.info("Não foram identificadas leads no texto.");
      else toast.success(`${res.totalLeads} lead(s) identificada(s)`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      if (msg.includes("CREDITS_EXHAUSTED")) toast.error("Créditos de IA esgotados. Adicione créditos no workspace.");
      else if (msg.includes("RATE_LIMITED")) toast.error("Demasiados pedidos. Tente daqui a um momento.");
      else toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cruzar Leads</h1>
        <p className="text-muted-foreground mt-1">
          Cole mensagens dos seus grupos de WhatsApp. A IA identifica quem procura imóvel e cruza com o seu portefólio.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-secondary text-primary inline-flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold">Cole o texto dos grupos</h2>
            <p className="text-sm text-muted-foreground">
              Abra o WhatsApp Web, selecione várias mensagens (ou exporte a conversa) e cole abaixo.
            </p>
          </div>
        </div>
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={10}
          placeholder="Ex: João — Procuro T2 em Cascais para arrendar até 1200€/mês&#10;Maria — Família quer comprar moradia em Sintra, máx 350.000€..."
          className="font-mono text-sm"
        />
        <Button onClick={submit} disabled={loading} size="lg" className="w-full sm:w-auto">
          <Sparkles className="w-4 h-4 mr-2" />
          {loading ? "A analisar..." : "Analisar e cruzar"}
        </Button>
      </Card>

      {totalLeads !== null && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">
              {results.filter((r) => r.matches.length > 0).length} de {totalLeads} leads com correspondências
            </h2>
          </div>

          {results.map((r, i) => (
            <Card key={i} className="p-5 space-y-4">
              <div className="border-l-4 border-primary pl-4">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <Badge variant={r.lead.finalidade === "venda" ? "default" : r.lead.finalidade === "arrendamento" ? "secondary" : "outline"}>
                    {r.lead.finalidade}
                  </Badge>
                  {r.lead.tipologia && <Badge variant="outline">{r.lead.tipologia}</Badge>}
                  {r.lead.zona && <Badge variant="outline"><MapPin className="w-3 h-3 mr-1" />{r.lead.zona}</Badge>}
                  {r.lead.preco_max && <Badge variant="outline"><Euro className="w-3 h-3 mr-1" />até {r.lead.preco_max.toLocaleString("pt-PT")}</Badge>}
                  {r.lead.contacto && <Badge variant="outline"><Phone className="w-3 h-3 mr-1" />{r.lead.contacto}</Badge>}
                </div>
                <p className="font-medium">{r.lead.resumo}</p>
                <p className="text-xs text-muted-foreground mt-1 italic">"{r.lead.mensagem_original}"</p>
              </div>

              {r.matches.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-4">Nenhum imóvel do seu portefólio corresponde.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Imóveis sugeridos:</p>
                  {r.matches.map((m) => (
                    <div key={m.property.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border">
                      <div>
                        <div className="font-semibold">
                          {m.property.tipologia} · {m.property.zona}
                          <span className="ml-2 text-primary">€{Number(m.property.preco).toLocaleString("pt-PT")}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{m.reasons.join(" · ")}</p>
                      </div>
                      <Badge className="bg-accent text-accent-foreground">{m.score}% match</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
