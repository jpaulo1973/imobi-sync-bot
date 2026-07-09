import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  matchWhatsappConversations,
  createBuyersFromLeads,
  type QualifiedLead,
  type LeadMatchResult,
} from "@/lib/whatsapp-leads.functions";
import { saveActiveSearch } from "@/lib/active-searches.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, ImagePlus, X, Sparkles, ArrowRight, UserPlus, MessageCircle, Phone, Copy, Radar } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/cruzar")({
  head: () => ({
    meta: [
      { title: "Fazer Match a partir do WhatsApp — Property Match" },
      {
        name: "description",
        content:
          "Cola conversas de WhatsApp e o Property Match encontra automaticamente os imóveis compatíveis da tua carteira.",
      },
      { property: "og:title", content: "Fazer Match a partir do WhatsApp — Property Match" },
      {
        property: "og:description",
        content:
          "A IA lê a conversa, identifica o pedido do comprador e devolve imediatamente os imóveis compatíveis da tua carteira.",
      },
      { property: "og:url", content: "https://imobi-sync-bot.lovable.app/cruzar" },
    ],
    links: [{ rel: "canonical", href: "https://imobi-sync-bot.lovable.app/cruzar" }],
  }),
  component: CruzarPage,
});

const MAX_IMGS = 20;

function euros(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function scoreTone(score: number) {
  if (score >= 80) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (score >= 60) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function CruzarPage() {
  const [texto, setTexto] = useState("");
  const [imagens, setImagens] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<LeadMatchResult[] | null>(null);
  const [totalCapturas, setTotalCapturas] = useState(0);
  const [totalProperties, setTotalProperties] = useState(0);
  const [creatingIdx, setCreatingIdx] = useState<number | null>(null);
  const [savedRadarIdx, setSavedRadarIdx] = useState<Record<number, boolean>>({});
  const [durationByIdx, setDurationByIdx] = useState<Record<number, number>>({});
  const [savingRadarIdx, setSavingRadarIdx] = useState<number | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const matchFn = useServerFn(matchWhatsappConversations);
  const createFn = useServerFn(createBuyersFromLeads);
  const saveRadarFn = useServerFn(saveActiveSearch);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) return;
    const remaining = MAX_IMGS - imagens.length;
    if (remaining <= 0) return toast.error(`Máximo ${MAX_IMGS} imagens.`);
    try {
      const urls = await Promise.all(arr.slice(0, remaining).map(fileToDataUrl));
      setImagens((prev) => [...prev, ...urls]);
    } catch {
      toast.error("Erro a ler imagem.");
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f && f.type.startsWith("image/")) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const submit = async () => {
    if (texto.trim().length < 10 && imagens.length === 0) {
      return toast.error("Cola texto ou adiciona pelo menos uma captura de ecrã.");
    }
    setLoading(true);
    setResults(null);
    try {
      const res = await matchFn({ data: { texto, imagens } });
      setTotalCapturas(res.total_capturas ?? imagens.length);
      setTotalProperties(res.total_properties);
      setResults(res.results);
      const totalMatches = res.results.reduce((n, r) => n + r.matches.length, 0);
      if (res.results.length === 0) toast.info("Nenhum pedido de comprador foi identificado na conversa.");
      else if (totalMatches === 0) toast.info("Pedidos identificados, mas sem imóveis compatíveis na carteira.");
      else toast.success(`${totalMatches} imóvel(is) compatível(is) encontrado(s).`);
      // Release 1.2 P1 #4 — sucesso: limpa a caixa e volta a focar.
      setTexto("");
      setImagens([]);
      setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      if (msg.includes("CREDITS_EXHAUSTED")) toast.error("Créditos de IA esgotados.");
      else if (msg.includes("RATE_LIMITED")) toast.error("Demasiados pedidos, tenta novamente em breve.");
      else toast.error(msg);
      // Erro: mantém o texto para o utilizador poder tentar de novo.
    } finally {
      setLoading(false);
    }
  };

  const saveAsLead = async (idx: number, lead: QualifiedLead) => {
    setCreatingIdx(idx);
    try {
      const res = await createFn({
        data: {
          leads: [
            {
              nome: lead.nome ?? null,
              finalidade: lead.finalidade,
              tipo_imovel: lead.tipo_imovel ?? null,
              tipologia: lead.tipologia ?? null,
              zona: lead.zona ?? null,
              budget_min: lead.budget_min ?? null,
              budget_max: lead.budget_max ?? null,
              area_min: lead.area_min ?? null,
              quartos_min: lead.quartos_min ?? null,
              caracteristicas: lead.caracteristicas ?? null,
              contacto: lead.contacto ?? null,
              resumo: lead.resumo,
              mensagem_original: lead.mensagem_original ?? null,
              confianca: lead.confianca,
            },
          ],
        },
      });
      toast.success(res.inserted > 0 ? "Contacto guardado nos clientes." : "Nada foi guardado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao guardar contacto.");
    } finally {
      setCreatingIdx(null);
    }
  };

  const saveToRadar = async (idx: number, lead: QualifiedLead) => {
    const days = durationByIdx[idx] ?? 14;
    setSavingRadarIdx(idx);
    try {
      await saveRadarFn({
        data: {
          criteria: {
            nome: lead.nome ?? null,
            finalidade: lead.finalidade,
            tipo_imovel: lead.tipo_imovel ?? null,
            tipologia: lead.tipologia ?? null,
            zona: lead.zona ?? null,
            budget_min: lead.budget_min ?? null,
            budget_max: lead.budget_max ?? null,
            area_min: lead.area_min ?? null,
            quartos_min: lead.quartos_min ?? null,
            caracteristicas: lead.caracteristicas ?? null,
          },
          resumo: lead.resumo,
          texto_original: lead.mensagem_original ?? null,
          contact_nome: lead.nome ?? null,
          contact_telefone: lead.telefone ?? lead.contacto ?? null,
          contact_grupo: lead.grupo_whatsapp ?? null,
          data_publicacao: lead.data_publicacao ?? null,
          duration_days: days,
          consultor_nome: lead.contacto ?? null,
          data_origem: lead.data_publicacao ?? null,
          grupo_whatsapp: lead.grupo_whatsapp ?? null,
          origem: "whatsapp",
        },
      });
      setSavedRadarIdx((m) => ({ ...m, [idx]: true }));
      toast.success(`Procura ativa durante ${days} dias.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao ativar procura.");
    } finally {
      setSavingRadarIdx(null);
    }
  };

  // Release 1.2 P1 #5 — uma mensagem com várias procuras gera vários registos.
  const saveAllToRadar = async () => {
    if (!results || results.length === 0) return;
    setSavingAll(true);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < results.length; i++) {
      if (savedRadarIdx[i]) continue;
      try {
        await saveRadarFn({
          data: {
            criteria: {
              nome: results[i].lead.nome ?? null,
              finalidade: results[i].lead.finalidade,
              tipo_imovel: results[i].lead.tipo_imovel ?? null,
              tipologia: results[i].lead.tipologia ?? null,
              zona: results[i].lead.zona ?? null,
              budget_min: results[i].lead.budget_min ?? null,
              budget_max: results[i].lead.budget_max ?? null,
              area_min: results[i].lead.area_min ?? null,
              quartos_min: results[i].lead.quartos_min ?? null,
              caracteristicas: results[i].lead.caracteristicas ?? null,
            },
            resumo: results[i].lead.resumo,
            texto_original: results[i].lead.mensagem_original ?? null,
            contact_nome: results[i].lead.nome ?? null,
            contact_telefone: results[i].lead.telefone ?? results[i].lead.contacto ?? null,
            contact_grupo: results[i].lead.grupo_whatsapp ?? null,
            data_publicacao: results[i].lead.data_publicacao ?? null,
            duration_days: durationByIdx[i] ?? 14,
            consultor_nome: results[i].lead.contacto ?? null,
            data_origem: results[i].lead.data_publicacao ?? null,
            grupo_whatsapp: results[i].lead.grupo_whatsapp ?? null,
            origem: "whatsapp",
          },
        });
        setSavedRadarIdx((m) => ({ ...m, [i]: true }));
        ok++;
      } catch {
        fail++;
      }
    }
    setSavingAll(false);
    if (ok > 0) toast.success(`${ok} procura(s) guardada(s) no Radar.${fail ? ` ${fail} falha(s).` : ""}`);
    else if (fail > 0) toast.error(`Falha ao guardar ${fail} procura(s).`);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fazer Match a partir do WhatsApp</h1>
        <p className="text-muted-foreground mt-1">
          A IA analisa as mensagens do WhatsApp, identifica automaticamente os critérios do comprador
          e procura correspondências na tua carteira, apresentando de imediato os imóveis compatíveis.
        </p>
      </div>

      <Card className="p-6 space-y-4" onPaste={onPaste}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-secondary text-primary inline-flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-semibold">Conversa a analisar</h2>
            <p className="text-sm text-muted-foreground">
              Cola texto e/ou adiciona capturas de ecrã. Várias capturas da mesma conversa são
              tratadas em conjunto.
            </p>
          </div>
        </div>

        <Textarea
          ref={textareaRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          placeholder="(Opcional) Cola aqui texto de conversas WhatsApp..."
          className="font-mono text-sm"
        />

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {imagens.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {imagens.map((src, i) => (
              <div key={i} className="relative group border rounded-md overflow-hidden bg-muted">
                <img src={src} alt={`captura ${i + 1}`} className="w-full h-24 object-cover" />
                <span className="absolute bottom-1 left-1 text-[10px] px-1 rounded bg-background/80 border">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setImagens((p) => p.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 p-1 rounded-full bg-background/90 border shadow-sm opacity-0 group-hover:opacity-100 transition"
                  aria-label="Remover"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={loading || imagens.length >= MAX_IMGS}
          >
            <ImagePlus className="w-4 h-4 mr-2" />
            Adicionar capturas {imagens.length > 0 && `(${imagens.length}/${MAX_IMGS})`}
          </Button>
          <Button onClick={submit} disabled={loading} size="lg" className="w-full sm:w-auto">
            <Sparkles className="w-4 h-4 mr-2" />
            {loading ? "A procurar correspondências..." : "Fazer Match"}
          </Button>
        </div>
      </Card>

      {results && (
        <div className="space-y-4">
          <Card className="p-4 text-sm text-muted-foreground">
            Analisadas <strong>{totalCapturas}</strong> captura(s) contra{" "}
            <strong>{totalProperties}</strong> imóvel(is) ativo(s) da carteira.
            {" "}
            Identificado(s) <strong>{results.length}</strong> pedido(s).
          </Card>

          {results.length > 1 && (
            <div className="flex items-center justify-end">
              <Button
                size="sm"
                onClick={saveAllToRadar}
                disabled={savingAll}
                variant="secondary"
              >
                <Radar className="w-4 h-4 mr-2" />
                {savingAll
                  ? "A guardar todas..."
                  : `Guardar as ${results.length} procuras no Radar`}
              </Button>
            </div>
          )}

          {results.length === 0 && (
            <Card className="p-6 text-center text-muted-foreground">
              Nenhum pedido de comprador identificado na conversa.
            </Card>
          )}

          {results.map((r, i) => (
            <Card key={i} className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={r.lead.finalidade === "arrendamento" ? "secondary" : "default"}>
                      {r.lead.finalidade === "venda"
                        ? "Compra"
                        : r.lead.finalidade === "arrendamento"
                          ? "Arrendamento"
                          : "Indefinido"}
                    </Badge>
                    {r.lead.tipologia && <Badge variant="outline">{r.lead.tipologia}</Badge>}
                    {r.lead.zona && <Badge variant="outline">{r.lead.zona}</Badge>}
                    {r.lead.budget_max != null && (
                      <Badge variant="outline">até {euros(r.lead.budget_max)}</Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium">{r.lead.resumo}</p>
                  {r.lead.mensagem_original && (
                    <p className="text-xs italic text-muted-foreground">
                      "{r.lead.mensagem_original}"
                    </p>
                  )}
                  {(r.lead.telefone || r.lead.grupo_whatsapp || r.lead.data_publicacao) && (
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 pt-1">
                      {r.lead.telefone && <span>{r.lead.telefone}</span>}
                      {r.lead.grupo_whatsapp && <span>Grupo: {r.lead.grupo_whatsapp}</span>}
                      {r.lead.data_publicacao && <span>Publicada: {r.lead.data_publicacao}</span>}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {r.lead.telefone && (
                    <>
                      <Button asChild size="sm" variant="outline">
                        <a
                          href={`https://wa.me/${r.lead.telefone.replace(/[^\d+]/g, "").replace(/^\+/, "")}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp
                        </a>
                      </Button>
                      <PhoneButton telefone={r.lead.telefone} />
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => saveAsLead(i, r.lead)}
                    disabled={creatingIdx === i}
                    title="Guardar como cliente (opcional)"
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    {creatingIdx === i ? "A guardar..." : "Guardar cliente"}
                  </Button>
                </div>
              </div>

              {r.matches.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Não foram encontrados imóveis compatíveis na carteira atual.
                  </p>
                  {savedRadarIdx[i] ? (
                    <div className="flex items-center gap-2 text-sm text-emerald-700">
                      <Radar className="w-4 h-4" />
                      Procura ativa no Radar. Serás notificado quando entrar um imóvel compatível.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        Manter esta procura ativa e comparar automaticamente com novos imóveis?
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={durationByIdx[i] ?? 14}
                          onChange={(e) =>
                            setDurationByIdx((m) => ({ ...m, [i]: Number(e.target.value) }))
                          }
                        >
                          <option value={7}>7 dias</option>
                          <option value={14}>14 dias (recomendado)</option>
                          <option value={21}>21 dias</option>
                          <option value={30}>30 dias</option>
                        </select>
                        <Button
                          size="sm"
                          onClick={() => saveToRadar(i, r.lead)}
                          disabled={savingRadarIdx === i}
                        >
                          <Radar className="w-4 h-4 mr-2" />
                          {savingRadarIdx === i ? "A ativar..." : "Sim, manter ativa"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSavedRadarIdx((m) => ({ ...m, [i]: true }))}
                        >
                          Não
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    {r.matches.length} imóvel(is) compatível(is)
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {r.matches.map((m) => (
                      <div
                        key={m.property.id}
                        className="border rounded-lg p-3 space-y-2 bg-background"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {m.property.referencia ?? m.property.tipo_imovel ?? "Imóvel"}
                              {m.property.tipologia ? ` · ${m.property.tipologia}` : ""}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {[m.property.freguesia, m.property.concelho, m.property.zona]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </div>
                          </div>
                          <Badge variant="outline" className={scoreTone(m.score)}>
                            {m.score}%
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{euros(m.property.preco)}</span>
                          {m.property.quartos != null && <span>{m.property.quartos} q</span>}
                          {m.property.area_util_m2 != null && (
                            <span>{m.property.area_util_m2} m²</span>
                          )}
                        </div>
                        {m.reasons.length > 0 && (
                          <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                            {m.reasons.slice(0, 3).map((reason, j) => (
                              <li key={j}>{reason}</li>
                            ))}
                          </ul>
                        )}
                        <div className="pt-1">
                          <Link
                            to="/imoveis"
                            search={{ q: m.property.referencia ?? m.property.id }}
                            className="inline-flex items-center text-xs font-medium text-primary hover:underline"
                          >
                            Abrir ficha do imóvel
                            <ArrowRight className="w-3 h-3 ml-1" />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}