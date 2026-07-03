import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Home, Sparkles, LogOut, Users, Link2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isCurrentUserAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
  },
  component: Layout,
});

function Layout() {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    isCurrentUserAdmin()
      .then((r) => setIsAdmin(r.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);
  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/imoveis" className="flex items-center gap-2 font-bold text-lg">
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground inline-flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            ImoMatch
          </Link>
          <nav className="flex items-center gap-1">
            <Link
              to="/imoveis"
              className="px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary inline-flex items-center gap-2 [&.active]:bg-secondary [&.active]:text-primary"
              activeProps={{ className: "active" }}
            >
              <Home className="w-4 h-4" /> Imóveis
            </Link>
            <Link
              to="/clientes"
              className="px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary inline-flex items-center gap-2 [&.active]:bg-secondary [&.active]:text-primary"
              activeProps={{ className: "active" }}
            >
              <Users className="w-4 h-4" /> Clientes
            </Link>
            <Link
              to="/portais"
              className="px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary inline-flex items-center gap-2 [&.active]:bg-secondary [&.active]:text-primary"
              activeProps={{ className: "active" }}
            >
              <Link2 className="w-4 h-4" /> Portais
            </Link>
            <Link
              to="/cruzar"
              className="px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary inline-flex items-center gap-2 [&.active]:bg-secondary [&.active]:text-primary"
              activeProps={{ className: "active" }}
            >
              <Sparkles className="w-4 h-4" /> Cruzar Leads
            </Link>
            {isAdmin && (
              <Link
                to="/utilizadores"
                className="px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary inline-flex items-center gap-2 [&.active]:bg-secondary [&.active]:text-primary"
                activeProps={{ className: "active" }}
              >
                <Shield className="w-4 h-4" /> Utilizadores
              </Link>
            )}
            <Button variant="ghost" size="sm" onClick={logout} className="ml-2">
              <LogOut className="w-4 h-4" />
            </Button>
          </nav>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
