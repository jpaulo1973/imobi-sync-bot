import { useState } from "react";
import { ChevronDown, MessageSquareText } from "lucide-react";

/**
 * Bloco recolhível com a mensagem original da procura:
 * - origem WhatsApp/lead → texto completo da mensagem recebida
 * - origem Cliente → Notas / Observações do comprador
 * Serve apenas de auditoria/contexto; não influencia o motor de match.
 */
export function OriginalMessage({
  texto,
  origem,
  defaultOpen = false,
  className = "",
}: {
  texto: string | null | undefined;
  origem?: string | null;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const conteudo = (texto ?? "").trim();
  if (!conteudo) return null;
  const isCliente = (origem ?? "").toLowerCase() === "cliente";
  const label = isCliente ? "Notas / Observações" : "Mensagem original";
  return (
    <div className={`rounded-md border bg-muted/40 ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <MessageSquareText className="w-3.5 h-3.5" />
        {label}
        <ChevronDown
          className={`w-3.5 h-3.5 ml-auto transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <p className="px-2.5 pb-2 text-xs whitespace-pre-wrap break-words text-foreground/90">
          {conteudo}
        </p>
      )}
    </div>
  );
}