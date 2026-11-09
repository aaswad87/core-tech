import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./harness";

/**
 * Schema-wide security rules from the Phase 13 audit. These look at the whole database after every
 * migration, so a new table or function that forgets a rule fails here even without its own test.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

const names = (rows: Record<string, unknown>[], key: string) => rows.map((r) => r[key] as string).sort();

describe("schema security invariants", () => {
  it("enables row level security on every public table", async () => {
    const rows = await db.admin(
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity",
    );
    expect(names(rows, "relname")).toEqual([]);
  });

  it("gives anonymous visitors no table privileges at all", async () => {
    const rows = await db.admin("select table_name, privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'");
    expect(rows).toEqual([]);
  });

  it("lets anonymous visitors call only the public job board functions", async () => {
    const rows = await db.admin(
      `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(names(rows, "f")).toEqual(["public.get_published_job", "public.get_published_jobs"]);
  });

  it("pins search_path on every SECURITY DEFINER function", async () => {
    const rows = await db.admin(
      `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname in ('public', 'private')
         and not coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'`,
    );
    expect(names(rows, "f")).toEqual([]);
  });

  it("keeps direct write grants to the reviewed set (everything else goes through functions)", async () => {
    const rows = await db.admin(
      `select table_name || ':' || string_agg(privilege_type, ',' order by privilege_type) as g
       from information_schema.role_table_grants
       where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
       group by table_name`,
    );
    expect(names(rows, "g")).toEqual(
      [
        "applications:INSERT",
        "candidate_certifications:DELETE,INSERT,UPDATE",
        "candidate_notes:DELETE,INSERT",
        "candidate_resumes:DELETE,INSERT",
        "candidate_skills:DELETE,INSERT,UPDATE",
        "candidate_work_history:DELETE,INSERT,UPDATE",
        "candidates:DELETE,INSERT,UPDATE",
        "companies:DELETE,INSERT,UPDATE",
        "jobs:INSERT,UPDATE",
        "market_hunt_subscribers:DELETE,INSERT",
        "market_hunts:DELETE,INSERT,UPDATE",
        "market_watch_companies:DELETE,INSERT,UPDATE",
      ].sort(),
    );
  });

  it("checks new rows on every insert/update policy", async () => {
    const rows = await db.admin("select tablename || '.' || policyname as p from pg_policies where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'ALL') and with_check is null");
    expect(names(rows, "p")).toEqual([]);
  });

  it("grants every policy to signed-in users only", async () => {
    const rows = await db.admin("select schemaname || '.' || tablename || '.' || policyname as p from pg_policies where roles <> array['authenticated']::name[]");
    expect(names(rows, "p")).toEqual([]);
  });

  it("keeps the private helper schema closed to anonymous visitors", async () => {
    const [row] = await db.admin("select has_schema_privilege('anon', 'private', 'usage') as anon");
    expect(row.anon).toBe(false);
  });

  it("limits storage policies to the private resumes bucket", async () => {
    const rows = await db.admin("select policyname, coalesce(qual, '') || coalesce(with_check, '') as expr from pg_policies where schemaname = 'storage'");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.expr as string, r.policyname as string).toContain("'resumes'::text");
    const [bucket] = await db.admin("select public from storage.buckets where id = 'resumes'");
    expect(bucket.public).toBe(false);
  });
});
