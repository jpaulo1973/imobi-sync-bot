import { describe, expect, it } from "vitest";

// Regressão do bug "permission denied for function has_role".
// Estes testes batem no endpoint REST publicado, validando as garantias
// que só podem ser verificadas end-to-end via PostgREST:
//   - anon NÃO pode invocar has_role  → 401/403 com mensagem de permissão
//   - o próprio endpoint existe e responde (função continua acessível ao Data API)
//
// A validação (a) authenticated executa e (b) RLS que usa has_role continua
// a funcionar está em supabase/tests/has_role_regression.sql, porque exige
// SET ROLE (privilégios de owner). Correr esse ficheiro no SQL editor
// completa a matriz de regressão.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? import.meta.env?.VITE_SUPABASE_URL;
const ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;

const skip = !SUPABASE_URL || !ANON_KEY;

describe.skipIf(skip)("has_role permissions (REST)", () => {
  it("anon receives permission denied on rpc/has_role", async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/has_role`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: ANON_KEY!,
        // Sem Authorization Bearer → PostgREST usa role 'anon'.
      },
      body: JSON.stringify({
        _user_id: "00000000-0000-0000-0000-000000000000",
        _role: "admin",
      }),
    });

    // Esperamos 401/403. O sintoma da regressão original era 500 ou 403
    // com mensagem "permission denied for function has_role" — o que
    // também é aceitável desde que anon fique bloqueado.
    expect([401, 403]).toContain(res.status);

    const body = await res.text();
    // Garante que não é um "OK" (que significaria função aberta a anon)
    expect(body).not.toMatch(/^\s*(true|false)\s*$/i);
  });

  it("endpoint rpc/has_role está publicado (responde, não 404)", async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/has_role`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: ANON_KEY! },
      body: JSON.stringify({ _user_id: "x", _role: "admin" }),
    });
    expect(res.status).not.toBe(404);
  });
});