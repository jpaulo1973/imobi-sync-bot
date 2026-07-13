import { Phone, Copy, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { useMemo } from "react";

function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

// Normaliza um número para o formato wa.me (E.164 sem '+').
// Garante prefixo 351 para números portugueses de 9 dígitos.
export function toWhatsAppNumber(telefone: string): string {
  let s = String(telefone ?? "").replace(/\D+/g, "");
  if (!s) return "";
  if (s.startsWith("00")) s = s.slice(2);
  if (!s.startsWith("351") && s.length === 9) s = "351" + s;
  // Só aceitamos números com pelo menos 9 dígitos úteis. Caso contrário
  // devolvemos "" para o UI desativar o botão de WhatsApp.
  if (s.replace(/^351/, "").length < 9) return "";
  return s;
}

type Props = {
  telefone: string;
  variant?: "outline" | "ghost" | "default" | "secondary";
  size?: "sm" | "default" | "icon";
  compact?: boolean; // só ícone
};

export function PhoneButton({ telefone, variant = "outline", size = "sm", compact = false }: Props) {
  const clean = String(telefone ?? "").replace(/\s+/g, "");
  const wa = toWhatsAppNumber(telefone);
  const mobile = useMemo(() => isMobile(), []);

  const copy = () => {
    void navigator.clipboard.writeText(telefone);
    toast.success("Número copiado.");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={variant} size={size} title="Contactar">
          <Phone className={compact ? "w-4 h-4" : "w-4 h-4 mr-1"} />
          {!compact && "Contactar"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="end" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-2 min-w-[180px]">
          <div className="text-sm font-mono text-center select-all">{telefone}</div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="flex-1" onClick={copy}>
              <Copy className="w-3.5 h-3.5 mr-1" /> Copiar
            </Button>
            {mobile && (
              <Button asChild size="sm" variant="outline" className="flex-1">
                <a href={`tel:${clean}`}>
                  <Phone className="w-3.5 h-3.5 mr-1" /> Ligar
                </a>
              </Button>
            )}
          </div>
          {wa ? (
            <Button asChild size="sm" variant="outline" className="w-full">
              <a
                href={`https://wa.me/${wa}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                <MessageCircle className="w-3.5 h-3.5 mr-1" /> WhatsApp
              </a>
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="w-full" disabled title="Sem número válido para WhatsApp">
              <MessageCircle className="w-3.5 h-3.5 mr-1" /> WhatsApp indisponível
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}