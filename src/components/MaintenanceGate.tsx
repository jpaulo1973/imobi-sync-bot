import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMaintenanceStatus, type MaintenanceStatus } from "@/lib/maintenance.functions";
import { AlertTriangle } from "lucide-react";

// Release 1.3 — bloqueio full-page para utilizadores não-admin quando o
// modo de manutenção está activo. Admins continuam a operar (o layout
// mostra apenas um badge global — este componente não os bloqueia).

type Props = {
  isAdmin: boolean;
  children: React.ReactNode;
  onStatusChange?: (status: MaintenanceStatus) => void;
};

export function MaintenanceGate({ isAdmin, children, onStatusChange }: Props) {
  const statusFn = useServerFn(getMaintenanceStatus);
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      statusFn()
        .then((s) => {
          if (cancelled) return;
          setStatus(s);
          onStatusChange?.(s);
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [statusFn, onStatusChange]);

  if (status?.enabled && !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-4 p-8 border rounded-2xl bg-card shadow-sm">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 text-amber-700 inline-flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold">Sistema em manutenção</h1>
          <p className="text-muted-foreground text-sm whitespace-pre-line">
            {status.message ||
              "Estamos a atualizar o Property Match. Voltamos em instantes — obrigado pela paciência."}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}