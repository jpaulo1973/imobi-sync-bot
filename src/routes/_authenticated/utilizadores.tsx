import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Trash2, UserPlus, Ban, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createAppUser,
  deleteAppUser,
  isCurrentUserAdmin,
  listAppUsers,
  setAppUserActive,
  setAppUserRole,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/utilizadores")({
  // A verificação de admin depende da sessão no browser: sem isto, um acesso
  // directo por URL era avaliado no servidor (sem sessão) e redirecionava.
  ssr: false,
  beforeLoad: async () => {
    const res = await isCurrentUserAdmin();
    if (!res.isAdmin) throw redirect({ to: "/imoveis" });
  },
  component: UtilizadoresPage,
});

type AppUser = {
  id: string;
  email: string | undefined;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null | undefined;
  roles: string[];
  role: "admin" | "consultor";
  ativo: boolean;
};

function UtilizadoresPage() {
  const listFn = useServerFn(listAppUsers);
  const createFn = useServerFn(createAppUser);
  const deleteFn = useServerFn(deleteAppUser);
  const roleFn = useServerFn(setAppUserRole);
  const activeFn = useServerFn(setAppUserActive);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const refresh = async () => {
    try {
      const res = await listFn();
      setUsers(res.users as AppUser[]);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createFn({ data: { email, password, isAdmin } });
      toast.success("Utilizador criado");
      setEmail("");
      setPassword("");
      setIsAdmin(false);
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Remover definitivamente este utilizador? Esta ação é irreversível.")) return;
    try {
      await deleteFn({ data: { userId: id } });
      toast.success("Utilizador removido");
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const onChangeRole = async (id: string, role: "admin" | "consultor") => {
    try {
      await roleFn({ data: { userId: id, role } });
      toast.success(role === "admin" ? "Agora é Administrador" : "Agora é Consultor");
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const onToggleActive = async (id: string, ativo: boolean) => {
    if (!ativo && !confirm("Desativar esta conta? O utilizador deixa de conseguir entrar."))
      return;
    try {
      await activeFn({ data: { userId: id, ativo } });
      toast.success(ativo ? "Conta reativada" : "Conta desativada");
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Utilizadores</h1>
        <p className="text-muted-foreground text-sm">
          Só pessoas que criar aqui conseguem entrar na aplicação.
        </p>
      </div>

      <Card className="p-6">
        <h2 className="font-semibold mb-4 inline-flex items-center gap-2">
          <UserPlus className="w-4 h-4" /> Criar novo utilizador
        </h2>
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Palavra-passe (mín. 8)</Label>
            <Input
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Checkbox
              id="isAdmin"
              checked={isAdmin}
              onCheckedChange={(v) => setIsAdmin(v === true)}
            />
            <Label htmlFor="isAdmin" className="cursor-pointer">
              Dar permissões de administrador (pode gerir utilizadores)
            </Label>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={loading}>
              {loading ? "A criar..." : "Criar utilizador"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b font-semibold">Contas com acesso ({users.length})</div>
        <div className="divide-y">
          {users.map((u) => (
            <div key={u.id} className="p-4 flex items-center justify-between gap-4">
              <div>
                <div className="font-medium flex items-center gap-2">
                  {u.full_name || u.email}
                  {!u.ativo && <Badge variant="secondary">Desativado</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {u.full_name ? `${u.email} · ` : ""}
                  Criado em {new Date(u.created_at).toLocaleDateString("pt-PT")} · Último acesso:{" "}
                  {u.last_sign_in_at
                    ? new Date(u.last_sign_in_at).toLocaleString("pt-PT")
                    : "nunca"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={u.role}
                  onValueChange={(v) => onChangeRole(u.id, v as "admin" | "consultor")}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consultor">Consultor</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  title={u.ativo ? "Desativar conta" : "Reativar conta"}
                  onClick={() => onToggleActive(u.id, !u.ativo)}
                >
                  {u.ativo ? <Ban className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Remover definitivamente"
                  onClick={() => onDelete(u.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">Sem utilizadores.</div>
          )}
        </div>
      </Card>
    </div>
  );
}