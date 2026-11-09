import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./harness";

let db: TestDb;
let org: string;
let otherOrg: string;
let admin: string;
let recruiter: string;
let recruiterB: string;
let employer: string;
let candidate: string;
let hunt: string;
let posting: string;
let match: string;
let otherOrgJob: string;

const STAFF_TABLES = [
  "market_hunts",
  "market_hunt_subscribers",
  "market_watch_companies",
  "market_postings",
  "market_matches",
  "market_scan_runs",
  "notification_deliveries",
];

beforeAll(async () => {
  db = await createTestDb();
  [{ id: org }] = (await db.admin("select id from public.organizations where is_default")) as { id: string }[];
  [{ id: otherOrg }] = (await db.admin(
    "insert into public.organizations (name, slug) values ('Other Agency', 'other') returning id",
  )) as { id: string }[];

  admin = await db.createUser("admin@coretech.test");
  await db.grantRole(admin, "admin");
  recruiter = await db.createUser("r@coretech.test", { appMeta: { invited: true } });
  recruiterB = await db.createUser("rb@coretech.test", { appMeta: { invited: true } });
  employer = await db.createUser("e@company.test", { appMeta: { invited: true } });
  candidate = await db.createUser("c@example.test");
  await db.asUser(admin, async (q) => {
    await q("select public.assign_role($1, 'recruiter')", [recruiter]);
    await q("select public.assign_role($1, 'recruiter')", [recruiterB]);
    await q("select public.assign_role($1, 'employer')", [employer]);
  });

  await db.asUser(recruiter, async (q) => {
    [{ id: hunt }] = (await q(
      `insert into public.market_hunts (organization_id, name, keywords, locations, created_by)
       values ($1, 'Texas network roles', array['network engineer', 'BGP'], array['Texas'], auth.uid()) returning id`,
      [org],
    )) as { id: string }[];
    await q("insert into public.market_hunt_subscribers (hunt_id, user_id) values ($1, auth.uid())", [hunt]);
    await q(
      `insert into public.market_watch_companies (organization_id, company_name, source, board_token, created_by)
       values ($1, 'Demo Corp', 'greenhouse', 'democorp', auth.uid())`,
      [org],
    );
  });

  // Postings, matches, runs and deliveries are written by the server's scan (service role).
  [{ id: posting }] = (await db.admin(
    `insert into public.market_postings (organization_id, source, external_id, dedupe_key, title, company_name, location, url)
     values ($1, 'jsearch', 'ext-1', 'demo|network engineer|dallas, tx', 'Network Engineer', 'Demo Corp', 'Dallas, TX', 'https://example.com/job/1')
     returning id`,
    [org],
  )) as { id: string }[];
  [{ id: match }] = (await db.admin(
    `insert into public.market_matches (organization_id, hunt_id, posting_id, score, matched_terms)
     values ($1, $2, $3, 4, array['network engineer']) returning id`,
    [org, hunt, posting],
  )) as { id: string }[];
  await db.admin("insert into public.market_scan_runs (organization_id, trigger, status) values ($1, 'schedule', 'succeeded')", [org]);
  await db.admin(
    `insert into public.notification_deliveries (organization_id, channel, recipient, related_type, status)
     values ($1, 'email', 'r@coretech.test', 'market_scan', 'sent')`,
    [org],
  );

  const [{ id: otherCompany }] = (await db.admin(
    "insert into public.companies (organization_id, name) values ($1, 'Elsewhere') returning id",
    [otherOrg],
  )) as { id: string }[];
  [{ id: otherOrgJob }] = (await db.admin(
    "insert into public.jobs (organization_id, company_id, title) values ($1, $2, 'Other org job') returning id",
    [otherOrg, otherCompany],
  )) as { id: string }[];
});

describe("market radar access", () => {
  it("is visible to staff", async () => {
    await db.asUser(recruiterB, async (q) => {
      for (const table of STAFF_TABLES) expect((await q(`select 1 from public.${table}`)).length, table).toBeGreaterThan(0);
    });
  });

  it("is invisible to employers and candidates", async () => {
    for (const user of [employer, candidate]) {
      await db.asUser(user, async (q) => {
        for (const table of STAFF_TABLES) expect(await q(`select 1 from public.${table}`), table).toHaveLength(0);
      });
    }
  });

  it("is denied to anonymous visitors", async () => {
    await db.asAnon(async (q) => {
      for (const table of STAFF_TABLES) await expect(q(`select 1 from public.${table}`), table).rejects.toThrow(/permission denied/);
    });
  });

  it("does not let any signed-in user write postings, runs or delivery logs", async () => {
    await db.asUser(admin, async (q) => {
      await expect(
        q(
          `insert into public.market_postings (organization_id, source, external_id, dedupe_key, title, url)
           values ($1, 'adzuna', 'x', 'x', 'Fake', 'https://evil.test')`,
          [org],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(q("insert into public.market_scan_runs (organization_id, trigger) values ($1, 'manual')", [org])).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        q(
          "insert into public.notification_deliveries (organization_id, channel, recipient, related_type, status) values ($1, 'email', 'x@y.z', 'x', 'sent')",
          [org],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(q("delete from public.market_postings")).rejects.toThrow(/permission denied/);
    });
  });

  it("does not let employers or candidates create hunts or watch companies", async () => {
    for (const user of [employer, candidate]) {
      await db.asUser(user, async (q) => {
        await expect(
          q(
            "insert into public.market_hunts (organization_id, name, keywords, created_by) values ($1, 'x', array['x'], auth.uid())",
            [org],
          ),
        ).rejects.toThrow(/row-level security/);
        await expect(
          q(
            "insert into public.market_watch_companies (organization_id, company_name, source, board_token, created_by) values ($1, 'x', 'lever', 'x', auth.uid())",
            [org],
          ),
        ).rejects.toThrow(/row-level security/);
      });
    }
  });
});

describe("hunt rules", () => {
  it("lets staff subscribe only themselves", async () => {
    await db.asUser(recruiterB, async (q) => {
      await expect(q("insert into public.market_hunt_subscribers (hunt_id, user_id) values ($1, $2)", [hunt, admin])).rejects.toThrow(
        /row-level security/,
      );
      await q("insert into public.market_hunt_subscribers (hunt_id, user_id) values ($1, auth.uid())", [hunt]);
      const removedOther = await q("delete from public.market_hunt_subscribers where user_id = $1 returning user_id", [recruiter]);
      expect(removedOther).toHaveLength(0);
    });
  });

  it("only lets the creator or an admin delete a hunt", async () => {
    const rows = await db.asUser(recruiterB, (q) => q("delete from public.market_hunts where id = $1 returning id", [hunt]));
    expect(rows).toHaveLength(0);
  });

  it("validates search terms and watch-company tokens", async () => {
    await db.asUser(recruiter, async (q) => {
      await expect(
        q("insert into public.market_hunts (organization_id, name, keywords, created_by) values ($1, 'x', '{}', auth.uid())", [org]),
      ).rejects.toThrow(/check/);
      await expect(
        q(
          "insert into public.market_hunts (organization_id, name, keywords, created_by) values ($1, 'x', array[' padded '], auth.uid())",
          [org],
        ),
      ).rejects.toThrow(/check/);
      await expect(
        q(
          "insert into public.market_watch_companies (organization_id, company_name, source, board_token, created_by) values ($1, 'x', 'adzuna', 'x', auth.uid())",
          [org],
        ),
      ).rejects.toThrow(/check/);
      await expect(
        q(
          "insert into public.market_watch_companies (organization_id, company_name, source, board_token, created_by) values ($1, 'x', 'lever', '../etc', auth.uid())",
          [org],
        ),
      ).rejects.toThrow(/check/);
    });
  });

  it("only accepts https posting URLs", async () => {
    await expect(
      db.admin(
        `insert into public.market_postings (organization_id, source, external_id, dedupe_key, title, url)
         values ($1, 'adzuna', 'js', 'k', 'X', 'javascript:alert(1)')`,
        [org],
      ),
    ).rejects.toThrow(/check/);
  });
});

describe("match review", () => {
  it("lets staff change status only, stamping the reviewer automatically", async () => {
    await db.asUser(recruiterB, async (q) => {
      await q("update public.market_matches set status = 'reviewing' where id = $1", [match]);
      await expect(q("update public.market_matches set score = 99 where id = $1", [match])).rejects.toThrow(/permission denied/);
      await expect(q("update public.market_matches set reviewed_by = $2 where id = $1", [match, admin])).rejects.toThrow(
        /permission denied/,
      );
    });
    const [row] = await db.admin("select status, reviewed_by, reviewed_at from public.market_matches where id = $1", [match]);
    expect(row.status).toBe("reviewing");
    expect(row.reviewed_by).toBe(recruiterB);
    expect(row.reviewed_at).not.toBeNull();
  });

  it("rejects linking a match to another organization's job", async () => {
    await db.asUser(recruiter, async (q) => {
      await expect(q("update public.market_matches set pursued_job_id = $2 where id = $1", [match, otherOrgJob])).rejects.toThrow(
        /same organization/,
      );
    });
  });

  it("does not let employers change matches", async () => {
    const rows = await db.asUser(employer, (q) => q("update public.market_matches set status = 'dismissed' where id = $1 returning id", [match]));
    expect(rows).toHaveLength(0);
  });
});
