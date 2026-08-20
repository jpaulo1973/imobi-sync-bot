/**
 * Deteta se um pedido HTTP é uma chamada RPC a uma server function.
 * Usado para decidir se um erro deve ser devolvido como JSON (RPC) ou como
 * página HTML (navegação normal).
 */
export function isServerFnRequest(request: Request | undefined): boolean {
  if (!request) return false;
  try {
    const url = new URL(request.url);
    if (url.pathname.includes("/_serverFn/")) return true;
    if (url.searchParams.has("_serverFnId")) return true;
  } catch {
    // URL inválido — trata como pedido normal.
  }
  const accept = request.headers?.get?.("accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}
