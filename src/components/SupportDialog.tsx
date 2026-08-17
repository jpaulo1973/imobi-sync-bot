import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { submitSupportRequest } from "@/lib/support.functions";

export function SupportDialog() {
  const [open, setOpen] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [sending, setSending] = useState(false);
  const submitFn = useServerFn(submitSupportRequest);

  const send = async () => {
    const texto = mensagem.trim();
    if (texto.length < 10) {
      toast.error("Escreva pelo menos 10 caracteres.");
      return;
    }
    setSending(true);
    try {
      await submitFn({ data: { mensagem: texto } });
      setMensagem("");
      setOpen(false);
      toast.success("Mensagem enviada, obrigado!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Ajuda ou sugestão" title="Ajuda / Sugestão">
          <LifeBuoy className="w-4 h-4" />
          <span className="hidden lg:inline ml-2">Ajuda</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajuda / Sugestão</DialogTitle>
          <DialogDescription>
            Descreva a dúvida, problema ou sugestão. A mensagem chega ao administrador com o seu
            nome e email de conta.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="support-message">Mensagem</Label>
          <Textarea
            id="support-message"
            rows={6}
            maxLength={2000}
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            placeholder="Ex: seria útil poder filtrar as procuras por consultor..."
          />
          <p className="text-xs text-muted-foreground">{mensagem.trim().length}/2000</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={send} disabled={sending}>
            {sending ? "A enviar..." : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}