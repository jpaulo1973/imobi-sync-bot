import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  listMatchNotifications,
  markAllMatchNotificationsRead,
  markMatchNotificationRead,
  sweepMatchNotifications,
  type MatchNotification,
} from "@/lib/match-notifications.functions";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MatchNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const listFn = useServerFn(listMatchNotifications);
  const sweepFn = useServerFn(sweepMatchNotifications);
  const readFn = useServerFn(markMatchNotificationRead);
  const readAllFn = useServerFn(markAllMatchNotificationsRead);

  const refresh = useCallback(() => {
    listFn()
      .then((r) => {
        setItems(r.items);
        setUnread(r.unread);
      })
      .catch(() => {});
  }, [listFn]);

  useEffect(() => {
    const run = () =>
      sweepFn()
        .catch(() => {})
        .finally(() => refresh());
    run();
    const id = setInterval(run, SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sweepFn, refresh]);

  const openItem = (n: MatchNotification) => {
    setOpen(false);
    if (n.read_at == null) {
      setItems((prev) =>
        prev.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)),
      );
      setUnread((u) => Math.max(0, u - 1));
      readFn({ data: { id: n.id } }).catch(() => {});
    }
  };

  const markAll = () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((i) => (i.read_at ? i : { ...i, read_at: now })));
    setUnread(0);
    readAllFn().catch(() => {});
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) refresh(); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label={unread > 0 ? `Notificações (${unread} não lidas)` : "Notificações"}
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] leading-none justify-center">
              {unread > 99 ? "99+" : unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">Novos matches</span>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={markAll} className="h-7 text-xs">
              <CheckCheck className="w-3.5 h-3.5 mr-1" /> Marcar todas como lidas
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted-foreground text-center">
              Sem notificações por agora.
            </p>
          )}
          {items.map((n) => {
            const cls = `block px-3 py-2 border-b last:border-0 hover:bg-secondary/60 ${
              n.read_at == null ? "bg-secondary/30" : ""
            }`;
            const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium truncate">
                  {n.buyer_label ?? "Comprador"}
                </span>
                <Badge variant="secondary" className="shrink-0">{n.score}%</Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {n.property_label ?? "Imóvel"}
              </p>
              {n.reason_summary && (
                <p className="text-xs text-muted-foreground/80 truncate">{n.reason_summary}</p>
              )}
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">{timeAgo(n.created_at)}</p>
            </>
            );
            return n.href.startsWith("/imoveis") ? (
              <Link
                key={n.id}
                to="/imoveis"
                search={{ open: n.property_id }}
                onClick={() => openItem(n)}
                className={cls}
              >
                {body}
              </Link>
            ) : (
              <Link key={n.id} to="/clientes" onClick={() => openItem(n)} className={cls}>
                {body}
              </Link>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
