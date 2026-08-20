import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { isServerFnRequest } from "./lib/server-fn-request";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    // Server-function (RPC) calls must never receive an HTML error page: o
    // cliente TanStack não consegue desserializar HTML e o erro real
    // desaparece atrás de "Erro desconhecido". Devolvemos JSON com a
    // mensagem verdadeira para que a UI a possa mostrar.
    if (isServerFnRequest(request)) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Erro interno no servidor";
      return new Response(
        JSON.stringify({
          error: true,
          message,
          ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        }),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
