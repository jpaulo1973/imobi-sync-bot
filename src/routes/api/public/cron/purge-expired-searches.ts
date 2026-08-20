// Release 1.2.7 — Rotina automática diária da limpeza definitiva de procuras
// expiradas (Excel + WhatsApp), agendada via pg_cron.
//
// Segurança: rota /api/public/* (sem sessão), protegida por segredo em header
// (`apikey`). A lógica corre no RPC `cron_purge_expired_searches`, executável
// apenas pelo service_role. ATENÇÃO: é um DELETE irreversível.
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest } from "@/lib/cron-auth";

async function run(request: Request) {
  const auth = authorizeCronRequest(request.headers, process.env as Record<string, string | undefined>);
  if (!auth.ok) {
    console.warn("[cron:purge-expired-searches] 401", auth.reason);
    return new Response(JSON.stringify({ error: "Unauthorized", reason: auth.reason }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("cron_purge_expired_searches", { p_dias: 0 });
  if (error) {
    console.error("[cron:purge-expired-searches] falhou", error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const res = (data ?? {}) as Record<string, unknown>;
  console.log("[cron:purge-expired-searches] apagadas", res["apagadas"]);
  return new Response(JSON.stringify({ success: true, ...res }), {
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/cron/purge-expired-searches")({
  server: { handlers: { POST: ({ request }) => run(request), GET: ({ request }) => run(request) } },
});
