import { describe, it, expect } from "vitest";
import { authorizeCronRequest, cronSecretsFromEnv, providedSecret } from "./cron-auth";

const KEY = "k".repeat(40);
const OUTRA = "z".repeat(40);
const h = (o: Record<string, string>) => new Headers(o);

describe("cronSecretsFromEnv", () => {
  it("aceita ANON_KEY, PUBLISHABLE_KEY e VITE_PUBLISHABLE_KEY", () => {
    expect(cronSecretsFromEnv({ SUPABASE_ANON_KEY: KEY })).toEqual([KEY]);
    expect(cronSecretsFromEnv({ SUPABASE_PUBLISHABLE_KEY: KEY })).toEqual([KEY]);
    expect(cronSecretsFromEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: KEY })).toEqual([KEY]);
  });
  it("deduplica e ignora vazios/curtos", () => {
    expect(
      cronSecretsFromEnv({ SUPABASE_ANON_KEY: KEY, SUPABASE_PUBLISHABLE_KEY: KEY }),
    ).toEqual([KEY]);
    expect(cronSecretsFromEnv({ SUPABASE_ANON_KEY: "  ", SUPABASE_PUBLISHABLE_KEY: "curta" })).toEqual([]);
  });
});

describe("providedSecret", () => {
  it("lê apikey", () => expect(providedSecret(h({ apikey: KEY }))).toBe(KEY));
  it("lê Bearer", () =>
    expect(providedSecret(h({ authorization: `Bearer ${KEY}` }))).toBe(KEY));
  it("devolve null sem headers", () => expect(providedSecret(h({}))).toBeNull());
});

describe("authorizeCronRequest", () => {
  const env = { SUPABASE_PUBLISHABLE_KEY: KEY };
  it("autoriza com o segredo correto (apikey e Bearer)", () => {
    expect(authorizeCronRequest(h({ apikey: KEY }), env)).toEqual({ ok: true });
    expect(authorizeCronRequest(h({ authorization: `Bearer ${KEY}` }), env)).toEqual({ ok: true });
  });
  it("rejeita segredo errado", () => {
    expect(authorizeCronRequest(h({ apikey: OUTRA }), env)).toEqual({
      ok: false,
      reason: "segredo_invalido",
    });
  });
  it("rejeita pedido sem segredo", () => {
    expect(authorizeCronRequest(h({}), env)).toEqual({
      ok: false,
      reason: "sem_segredo_no_pedido",
    });
  });
  it("falha fechada quando o ambiente não tem segredo (bug de produção 1.2.7)", () => {
    expect(authorizeCronRequest(h({ apikey: KEY }), {})).toEqual({
      ok: false,
      reason: "sem_segredo_configurado",
    });
  });
});
