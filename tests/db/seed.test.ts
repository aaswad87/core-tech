import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestDb } from "./harness";

describe("supabase/seed.sql", () => {
  it("applies cleanly and labels every record as demo data", async () => {
    const db = await createTestDb();
    await db.pg.exec(readFileSync(join(__dirname, "..", "..", "supabase", "seed.sql"), "utf8"));

    for (const table of ["companies", "jobs", "candidates"]) {
      const rows = await db.admin(`select is_demo from public.${table}`);
      expect(rows.length, table).toBeGreaterThan(0);
      expect(rows.every((r) => r.is_demo === true), table).toBe(true);
    }
    const names = await db.admin("select name as label from public.companies union all select title from public.jobs union all select last_name from public.candidates");
    expect(names.every((r) => String(r.label).includes("(Demo)"))).toBe(true);

    const published = await db.asAnon((q) => q("select id from public.get_published_jobs()"));
    expect(published).toHaveLength(2);
  });
});
