import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MessageCircle, User, Mail, Phone as PhoneIcon, Building2, Copy } from "lucide-react";
import { toWhatsAppNumber } from "@/components/PhoneButton";
import { toast } from "sonner";

// Release 1.3 — Ações de contacto entre consultores.
//
// Dois botões, aplicados em oportunidades onde o consultor visualizador é
// diferente do dono da procura/imóvel:
//  - WhatsApp: abre wa.me diretamente, sem mensagem pré-preenchida.
//  - Contacto: dialog só-leitura com Nome, Telemóvel, Email, Agência.
// Nunca inicia chamada.

export type ConsultorInfo = {
  nome?: string | null;
  telefone?: string | null;
  email?: string | null;
  agency?: string | null;
};

type Props = {
  consultor: ConsultorInfo;
  compact?: boolean;
};

export function ConsultorContactActions({ consultor, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const wa = useMemo(
    () => (consultor.telefone ? toWhatsAppNumber(consultor.telefone) : ""),
    [consultor.telefone],
  );
  const hasAny =
    !!consultor.nome || !!consultor.telefone || !!consultor.email || !!consultor.agency;

  const copy = (value: string, label: string) => {
    void navigator.clipboard.writeText(value);
    toast.success(`${label} copiado.`);
  };

  return (
    <div className="inline-flex items-center gap-1">
      <Button
        asChild={!!wa}
        size={compact ? "icon" : "sm"}
        variant="outline"
        disabled={!wa}
        title={wa ? "Abrir WhatsApp" : "Sem telemóvel do consultor"}
        aria-label="Abrir WhatsApp do consultor"
      >
        {wa ? (
          <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer noopener">
            <MessageCircle className={compact ? "w-4 h-4" : "w-4 h-4 mr-1"} />
            {!compact && "WhatsApp"}
          </a>
        ) : (
          <span>
            <MessageCircle className={compact ? "w-4 h-4" : "w-4 h-4 mr-1"} />
            {!compact && "WhatsApp"}
          </span>
        )}
      </Button>
      <Button
        size={compact ? "icon" : "sm"}
        variant="outline"
        onClick={() => setOpen(true)}
        title="Ver contacto"
        aria-label="Ver contacto do consultor"
        disabled={!hasAny}
      >
        <User className={compact ? "w-4 h-4" : "w-4 h-4 mr-1"} />
        {!compact && "Contacto"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Consultor responsável</DialogTitle>
            <DialogDescription>
              Dados de contacto entre consultores. Este ecrã não inicia chamadas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <Row icon={<User className="w-4 h-4" />} label="Nome" value={consultor.nome} />
            <Row
              icon={<PhoneIcon className="w-4 h-4" />}
              label="Telemóvel"
              value={consultor.telefone}
              onCopy={consultor.telefone ? () => copy(consultor.telefone!, "Número") : undefined}
              mono
            />
            <Row
              icon={<Mail className="w-4 h-4" />}
              label="Email"
              value={consultor.email}
              onCopy={consultor.email ? () => copy(consultor.email!, "Email") : undefined}
            />
            <Row
              icon={<Building2 className="w-4 h-4" />}
              label="Agência"
              value={consultor.agency}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  onCopy,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  onCopy?: () => void;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`truncate ${mono ? "font-mono" : "font-medium"}`}>
          {value ? value : <span className="text-muted-foreground">—</span>}
        </div>
      </div>
      {onCopy && (
        <Button variant="ghost" size="icon" onClick={onCopy} aria-label={`Copiar ${label}`}>
          <Copy className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}