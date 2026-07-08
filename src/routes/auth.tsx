import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Property Match" },
      {
        name: "description",
        content:
          "Aceda à Property Match para cruzar imóveis com procuras ativas de compradores e gerir o seu portefólio.",
      },
      { property: "og:title", content: "Entrar — Property Match" },
      {
        property: "og:description",
        content: "Motor Inteligente de Oportunidades para consultores imobiliários.",
      },
      { property: "og:url", content: "https://imobi-sync-bot.lovable.app/auth" },
    ],
    links: [{ rel: "canonical", href: "https://imobi-sync-bot.lovable.app/auth" }],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//") ? s.next : undefined,
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const goNext = () => {
    if (next) window.location.href = next;
    else navigate({ to: "/imoveis" });
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) goNext();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) toast.error(error.message);
    else goNext();
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-secondary via-background to-secondary">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-primary-foreground mb-4">
            <Building2 className="w-7 h-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Property Match — Motor Inteligente de Oportunidades
          </h1>
          <p className="text-muted-foreground mt-2">
            Encontre automaticamente o comprador certo para cada imóvel que angariou.
          </p>
        </div>
        <Card className="p-6">
          <form onSubmit={signIn} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Palavra-passe</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "A entrar..." : "Entrar"}
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              O acesso é restrito. Peça ao administrador para lhe criar uma conta.
            </p>
          </form>
        </Card>
      </div>
    </main>
  );
}
