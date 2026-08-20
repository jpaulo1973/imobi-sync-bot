import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const hasDb = !!process.env["PGHOST"];
const sqlPath = resolve(__dirname, "../../supabase/tests/purge_expired_regression.sql");

describe("admin_purge_expired_searches (integridade RPC)", () => {
  it.skipIf(!hasDb)("nunca apanha origem cliente e a contagem bate com o apagado", () => {
    const out = execSync(`psql -v ON_ERROR_STOP=1 -f "${sqlPath}" 2>&1`, {
      encoding: "utf-8",
      env: {
        ...process.env,
        PGHOST: process.env["PGHOST"] ?? "",
        PGPORT: process.env["PGPORT"] ?? "5432",
        PGDATABASE: process.env["PGDATABASE"] ?? "",
        PGUSER: process.env["PGUSER"] ?? "",
        PGPASSWORD: process.env["PGPASSWORD"] ?? "",
        PGSSLMODE: process.env["PGSSLMODE"] ?? "prefer",
      },
    });
    expect(out).toContain("OK purge expired");
    expect(out).toContain("OK rpc admin_purge_expired_searches presente");
    expect(out).not.toContain("REGRESSION");
  });
});
