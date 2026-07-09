import { Phone, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { useMemo } from "react";

function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

type Props = {
  telefone: string;
  variant?: "outline" | "ghost" | "default" | "secondary";
  size?: "sm" | "default" | "icon";
  compact?: boolean; // só ícone
};

export function PhoneButton({ telefone, variant = "outline", size = "sm", compact = false }: Props) {
  const clean = telefone.replace(/\s+/g, "");
  const mobile = useMemo(() => isMobile(), []);

  const copy = () => {
    void navigator.clipboard.writeText(telefone);
    toast.success("Número copiado.");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={variant} size={size} title="Mostrar telefone">
          <Phone className={compact ? "w-4 h-4" : "w-4 h-4 mr-1"} />
          {!compact && "Telefone"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="end">
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
        </div>
      </PopoverContent>
    </Popover>
  );
}