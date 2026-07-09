import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LogOut, KeyRound, Save, UserCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile, updateMyProfile } from "@/lib/profile.functions";

export const Route = createFileRoute("/_authenticated/perfil")({
  head: () => ({
    meta: [
      { title: "Perfil — Property Match" },
      {
        name: "description",
        content:
          "A sua conta Property Match: perfil, agência, estatísticas e gestão de sessão.",
      },
    ],
  }),
  component: PerfilPage,
});

type ProfileData = Awaited<ReturnType<typeof getMyProfile>>;

function PerfilPage() {
  const navigate = useNavigate();
  const getFn = useServerFn(getMyProfile);
  const updateFn = useServerFn(updateMyProfile);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [fullName, setFullName] = useState("");
  const [agency, setAgency] = useState("");
  const [saving, setSaving] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPwd, setChangingPwd] = useState(false);

  const refresh = async () => {
    try {
      const p = await getFn();
      setProfile(p);
      setFullName(p.fullName ?? "");
      setAgency(p.agency ?? "");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateFn({ data: { fullName, agency } });
      toast.success("Perfil atualizado");
      await refresh();
      window.dispatchEvent(new Event("pm:profile-updated"));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const onChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("A palavra-passe deve ter pelo menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As palavras-passe não coincidem.");
      return;
    }
    setChangingPwd(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPwd(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Palavra-passe atualizada");
  };

  const onLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const roleLabel = profile?.role === "admin" ? "Administrador" : "Consultor";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold inline-flex items-center gap-2">
          <UserCircle className="w-6 h-6" /> A minha conta
        </h1>
        <p className="text-muted-foreground text-sm">
          Confirme que está a trabalhar na conta correta e veja o resumo da sua atividade.
        </p>
      </div>

      {!profile ? (
        <Card className="p-6 text-sm text-muted-foreground">A carregar...</Card>
      ) : (
        <>
          <Card className="p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Autenticado como</div>
                <div className="text-lg font-semibold">
                  {profile.fullName || profile.email || "—"}
                </div>
                <div className="text-sm text-muted-foreground">{profile.email}</div>
              </div>
              <Badge variant={profile.role === "admin" ? "default" : "secondary"}>
                {roleLabel}
              </Badge>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 pt-2">
              <Stat label="Imóveis" value={profile.counts.properties} />
              <Stat label="Compradores" value={profile.counts.buyers} />
              <Stat label="Oportunidades" value={profile.counts.opportunities} />
              <Stat
                label="Último acesso"
                value={
                  profile.lastSignInAt
                    ? new Date(profile.lastSignInAt).toLocaleString("pt-PT")
                    : "—"
                }
              />
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold mb-4">Dados pessoais</h2>
            <form onSubmit={onSave} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Agência</Label>
                <Input
                  value={agency}
                  onChange={(e) => setAgency(e.target.value)}
                  placeholder="(opcional)"
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={saving}>
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? "A guardar..." : "Guardar"}
                </Button>
              </div>
            </form>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold mb-4 inline-flex items-center gap-2">
              <KeyRound className="w-4 h-4" /> Alterar palavra-passe
            </h2>
            <form onSubmit={onChangePassword} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nova palavra-passe</Label>
                <Input
                  type="password"
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Confirmar</Label>
                <Input
                  type="password"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" variant="secondary" disabled={changingPwd}>
                  {changingPwd ? "A atualizar..." : "Atualizar palavra-passe"}
                </Button>
              </div>
            </form>
          </Card>

          <Card className="p-6 flex items-center justify-between">
            <div>
              <div className="font-semibold">Terminar sessão</div>
              <div className="text-sm text-muted-foreground">
                Sai da conta {profile.email} neste dispositivo.
              </div>
            </div>
            <Button variant="destructive" onClick={onLogout}>
              <LogOut className="w-4 h-4 mr-2" /> Terminar sessão
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}