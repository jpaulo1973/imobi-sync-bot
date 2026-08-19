import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const hasDb = !!process.env["PGHOST"];
const sqlPath = resolve(__dirname, "../../supabase/tests/expiry_recalc_regression.sql");

describe("admin_recalc_excel_expiry (integridade RPC)", () => {
  it.skipIf(!hasDb)("não gera erro de GROUP BY e devolve distribuição por mês", () => {
    const out = execSync(`psql -v ON_ERROR_STOP=1 -f "${sqlPath}"`, {
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
    expect(out).toContain("OK distribuicao por mes");

    expect(out).not.toContain("REGRESSION");
  });
});
