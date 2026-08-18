import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UserCircle } from "lucide-react";
import type { ProfileMissingField } from "@/lib/profile.functions";

// Item 2 — alerta na primeira entrada quando faltam campos obrigatórios do
// perfil. Não é descartável enquanto faltarem campos: o utilizador pode
// continuar (fechar com "Mais tarde") mas o aviso volta a aparecer, e o
// banner fica visível no topo da aplicação.

const LABELS: Record<ProfileMissingField, string> = {
  fullName: "Nome completo",
  telefone: "Telemóvel",
  agency: "Agência",
  whatsapp: "WhatsApp",
};

type Props = {
  missing: ProfileMissingField[];
  open: boolean;
  onDismiss: () => void;
};

export function ProfileCompletionAlert({ missing, open, onDismiss }: Props) {
  if (missing.length === 0) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onDismiss() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCircle className="w-5 h-5" /> Complete o seu perfil
          </DialogTitle>
          <DialogDescription>
            Estes dados são usados pelos outros consultores para o contactarem sobre matches dos
            seus imóveis. Faltam:
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc pl-5 text-sm space-y-1">
          {missing.map((f) => (
            <li key={f}>{LABELS[f]}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss}>
            Mais tarde
          </Button>
          <Button asChild onClick={onDismiss}>
            <Link to="/perfil">Completar perfil</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProfileCompletionBanner({ missing }: { missing: ProfileMissingField[] }) {
  if (missing.length === 0) return null;
  return (
    <div className="bg-amber-100 text-amber-900 border-b border-amber-200 text-sm px-4 py-2 text-center">
      <strong>Perfil incompleto</strong> — faltam: {missing.map((f) => LABELS[f]).join(", ")}.{" "}
      <Link to="/perfil" className="underline font-medium">
        Completar agora
      </Link>
    </div>
  );
}
