import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const root = join(__dirname, "..", "..");
const migrationsDir = join(root, "supabase", "migrations");

/**
 * Real Postgres (PGlite) with a Supabase-like auth stub and every migration applied in order.
 * Queries run as the superuser unless wrapped in asUser/asAnon, which switch to the
 * `authenticated`/`anon` roles exactly as PostgREST does.
 */
export async function createTestDb() {
  const db = new PGlite();
  await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));

  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of migrations) {
    try {
      await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  return new TestDb(db);
}

type Row = Record<string, unknown>;

export class TestDb {
  constructor(readonly pg: PGlite) {}

  /** Superuser query — bypasses RLS. Use only for fixtures and assertions about raw state. */
  async admin<T extends Row = Row>(sql: string, params: unknown[] = []) {
    return (await this.pg.query<T>(sql, params)).rows;
  }

  /** Simulates Supabase Auth signup: inserts into auth.users, firing the provisioning trigger. */
  async createUser(
    email: string,
    options: { appMeta?: Row; userMeta?: Row } = {},
  ): Promise<string> {
    const [row] = await this.admin<{ id: string }>(
      "insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3) returning id",
      [email, JSON.stringify(options.appMeta ?? {}), JSON.stringify(options.userMeta ?? {})],
    );
    return row.id;
  }

  /** Grants a role directly as the database owner (used to bootstrap the first admin). */
  async grantRole(userId: string, role: string) {
    await this.admin(
      `insert into public.user_roles (user_id, organization_id, role)
       select id, organization_id, $2::public.app_role from public.profiles where id = $1
       on conflict do nothing`,
      [userId, role],
    );
  }

  async asUser<T>(userId: string, fn: (q: Query) => Promise<T>): Promise<T> {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    return this.withRole("authenticated", claims, fn);
  }

  async asAnon<T>(fn: (q: Query) => Promise<T>): Promise<T> {
    return this.withRole("anon", JSON.stringify({ role: "anon" }), fn);
  }

  private async withRole<T>(role: string, claims: string, fn: (q: Query) => Promise<T>): Promise<T> {
    await this.pg.query("select set_config('request.jwt.claims', $1, false)", [claims]);
    await this.pg.exec(`set role ${role}`);
    try {
      return await fn(async (sql, params = []) => (await this.pg.query<Row>(sql, params)).rows);
    } finally {
      await this.pg.exec("reset role");
      await this.pg.query("select set_config('request.jwt.claims', '', false)");
    }
  }
}

export type Query = (sql: string, params?: unknown[]) => Promise<Row[]>;
