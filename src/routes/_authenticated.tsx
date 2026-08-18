import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Home, Sparkles, LogOut, Users, Shield, Radar, FileSpreadsheet, UserCircle, AlertTriangle, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useServerFn } from "@tanstack/react-start";
import { countUnseenOpportunities } from "@/lib/active-searches.functions";
import { getMyProfile } from "@/lib/profile.functions";
import { listSupportRequests } from "@/lib/support.functions";
import { MaintenanceGate } from "@/components/MaintenanceGate";
import { NotificationBell } from "@/components/NotificationBell";
import { SupportDialog } from "@/components/SupportDialog";
import {
  ProfileCompletionAlert,
  ProfileCompletionBanner,
} from "@/components/ProfileCompletionAlert";
import type { ProfileMissingField } from "@/lib/profile.functions";
import type { MaintenanceStatus } from "@/lib/maintenance.functions";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
  },
  component: Layout,
});

function Layout() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<{ fullName: string | null; email: string | null; role: "admin" | "consultor" } | null>(null);
  const [missingFields, setMissingFields] = useState<ProfileMissingField[]>([]);
  const [alertOpen, setAlertOpen] = useState(false);
  const isAdmin = profile?.role === "admin";
  const [unseen, setUnseen] = useState(0);
  const countFn = useServerFn(countUnseenOpportunities);
  const profileFn = useServerFn(getMyProfile);
  const [maintenance, setMaintenance] = useState<MaintenanceStatus | null>(null);
  const [supportUnread, setSupportUnread] = useState(0);
  const supportListFn = useServerFn(listSupportRequests);
  useEffect(() => {
    const load = () =>
      profileFn()
        .then(async (p) => {
          if ((p as any).ativo === false) {
            await supabase.auth.signOut();
            navigate({ to: "/auth" });
            return;
          }
          setProfile({ fullName: p.fullName, email: p.email, role: p.role });
          const missing = ((p as any).missingFields ?? []) as ProfileMissingField[];
          setMissingFields(missing);
          if (missing.length > 0) setAlertOpen(true);
        })
        .catch(() => {
          setProfile(null);
          setMissingFields([]);
        });
    load();
    const onUpdated = () => load();
    window.addEventListener("pm:profile-updated", onUpdated);
    return () => window.removeEventListener("pm:profile-updated", onUpdated);
  }, [profileFn, navigate]);
  useEffect(() => {
    // Item 1 — o Radar é exclusivo de Admin: não sondar o contador para consultores.
    if (!isAdmin) {
      setUnseen(0);
      return;
    }
    const tick = () => countFn().then((r) => setUnseen(r.unseen)).catch(() => {});
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [countFn, isAdmin]);
  useEffect(() => {
    if (!isAdmin) return;
    const tick = () =>
      supportListFn()
        .then((r) => setSupportUnread(r.unread))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 120000);
    return () => clearInterval(id);
  }, [isAdmin, supportListFn]);
  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };
  const displayName = profile?.fullName || profile?.email || "";
  const roleLabel = profile?.role === "admin" ? "Administrador" : "Consultor";
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/imoveis" className="flex items-center gap-2 font-bold text-lg">
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground inline-flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            Property Match
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
            {isAdmin && (
              <>
                <Link
                  to="/cruzar"
                  className="px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary inline-flex items-center gap-2 [&.active]:bg-secondary [&.active]:text-primary"
                  activeProps={{ className: "active" }}
                >
                  <Sparkles className="w-4 h-4" /> Match WhatsApp
                </Link>
                <Link
                  to="/importar"
                  className="px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary inline-flex items-center gap-2 [&.active]:bg-secondary [&.active]:text-primary"
                  activeProps={{ className: "active" }}
                >
                  <FileSpreadsheet className="w-4 h-4" /> Importar
                </Link>
                <Link
                  to="/revisao"
                  className="px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary inline-flex items-center gap-2 [&.active]:bg-secondary [&.active]:text-primary"
                  activeProps={{ className: "active" }}
                >
                  <AlertTriangle className="w-4 h-4" /> Revisão
                </Link>
              </>
            )}
            {isAdmin && (
              <Link
                to="/radar"
                className="px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary inline-flex items-center gap-2 [&.active]:bg-secondary [&.active]:text-primary"
                activeProps={{ className: "active" }}
                onClick={() => setUnseen(0)}
              >
                <Radar className="w-4 h-4" /> Radar
                {unseen > 0 && (
                  <Badge variant="default" className="ml-1 h-5 min-w-5 px-1.5">{unseen}</Badge>
                )}
              </Link>
            )}
            {isAdmin && (
              <Link
                to="/utilizadores"
                className="px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary inline-flex items-center gap-2 [&.active]:bg-secondary [&.active]:text-primary"
                activeProps={{ className: "active" }}
              >
                <Shield className="w-4 h-4" /> Utilizadores
              </Link>
            )}
            {isAdmin && (
              <Link
                to="/manutencao"
                className="px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary inline-flex items-center gap-2 [&.active]:bg-secondary [&.active]:text-primary"
                activeProps={{ className: "active" }}
              >
                <Wrench className="w-4 h-4" /> Manutenção
                {supportUnread > 0 && (
                  <Badge variant="default" className="ml-1 h-5 min-w-5 px-1.5">
                    {supportUnread}
                  </Badge>
                )}
                {maintenance?.enabled && (
                  <Badge className="ml-1 bg-amber-100 text-amber-800 border-amber-200" variant="outline">
                    Activa
                  </Badge>
                )}
              </Link>
            )}
            <Link
              to="/perfil"
              className="px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary inline-flex items-center gap-2 [&.active]:bg-secondary [&.active]:text-primary"
              activeProps={{ className: "active" }}
            >
              <UserCircle className="w-4 h-4" /> Perfil
            </Link>
            <NotificationBell />
            <SupportDialog />
            {profile && (
              <div
                className="hidden md:flex items-center gap-2 ml-2 pl-3 border-l text-sm"
                title={profile.email ?? undefined}
              >
                <span className="font-medium truncate max-w-[180px]">{displayName}</span>
                <Badge variant={isAdmin ? "default" : "secondary"} className="whitespace-nowrap">
                  {roleLabel}
                </Badge>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="ml-2"
              aria-label="Terminar sessão"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </nav>
        </div>
      </header>
      {isAdmin && maintenance?.enabled && (
        <div className="bg-amber-100 text-amber-900 border-b border-amber-200 text-sm px-4 py-2 text-center">
          <strong>Modo de Manutenção activo</strong> — utilizadores não-admin estão bloqueados.
        </div>
      )}
      <ProfileCompletionBanner missing={missingFields} />
      <ProfileCompletionAlert
        missing={missingFields}
        open={alertOpen}
        onDismiss={() => setAlertOpen(false)}
      />
      <main className="flex-1 container mx-auto px-4 py-8">
        <MaintenanceGate isAdmin={isAdmin} onStatusChange={setMaintenance}>
          <Outlet />
        </MaintenanceGate>
      </main>
    </div>
  );
}
