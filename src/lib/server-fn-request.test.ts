import { describe, it, expect } from "vitest";
import { isServerFnRequest } from "./server-fn-request";

const req = (url: string, accept?: string) =>
  new Request(url, accept ? { headers: { accept } } : undefined);

describe("isServerFnRequest", () => {
  it("deteta caminho _serverFn", () => {
    expect(isServerFnRequest(req("https://x.dev/_serverFn/abc"))).toBe(true);
  });
  it("deteta query _serverFnId", () => {
    expect(isServerFnRequest(req("https://x.dev/cruzar?_serverFnId=abc"))).toBe(true);
  });
  it("navegação HTML não é RPC", () => {
    expect(isServerFnRequest(req("https://x.dev/cruzar", "text/html"))).toBe(false);
  });
  it("undefined não é RPC", () => {
    expect(isServerFnRequest(undefined)).toBe(false);
  });
});
