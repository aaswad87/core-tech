import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./harness";

let db: TestDb;
let org: string;
let admin: string;
let recruiter: string;
let employer: string;
let candidate: string;
let leadId: string;
const jobs: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDb();
  [{ id: org }] = (await db.admin("select id from public.organizations where is_default")) as { id: string }[];

  admin = await db.createUser("admin@coretech.test");
  await db.grantRole(admin, "admin");
  recruiter = await db.createUser("recruiter@coretech.test", { appMeta: { invited: true } });
  employer = await db.createUser("employer@company.test", { appMeta: { invited: true } });
  candidate = await db.createUser("candidate@example.test");
  await db.asUser(admin, async (q) => {
    await q("select public.assign_role($1, 'recruiter')", [recruiter]);
    await q("select public.assign_role($1, 'employer')", [employer]);
  });

  const [{ id: company }] = (await db.admin(
    "insert into public.companies (organization_id, name, is_demo) values ($1, 'Demo Co', true) returning id",
    [org],
  )) as { id: string }[];

  const job = async (key: string, title: string, status: string, arrangement: string, summary = "Summary") => {
    const [row] = (await db.admin(
      `insert into public.jobs (organization_id, company_id, title, public_summary, public_description, description,
         status, published_at, work_arrangement, is_demo)
       values ($1, $2, $3, $4, 'Public description', 'INTERNAL client notes', $5::public.job_status,
         case when $5 = 'published' then now() - ($6 || ' minutes')::interval end, $7::public.work_arrangement, true)
       returning id`,
      [org, company, title, summary, status, String(Object.keys(jobs).length), arrangement],
    )) as { id: string }[];
    jobs[key] = row.id;
  };
  await job("network", "Network Engineer (demo)", "published", "hybrid");
  await job("soc", "SOC Analyst 100% Remote (demo)", "published", "remote", "Security operations");
  await job("draft", "Cloud Architect (demo)", "draft", "remote");
  await job("paused", "RF Engineer (demo)", "paused", "onsite");

  // Leads are inserted the way the server does it: as the database owner / service role.
  [{ id: leadId }] = (await db.admin(
    `insert into public.leads (organization_id, type, full_name, email, message, consent_at, ip_hash)
     values ($1, 'contact', 'Demo Visitor', 'visitor@example.test', 'Hello', now(), 'hash-1') returning id`,
    [org],
  )) as { id: string }[];
});

describe("public job board", () => {
  it("lists only published jobs, newest first, with a total count", async () => {
    const rows = await db.asAnon((q) => q("select id, total_count from public.get_published_jobs()"));
    expect(rows.map((r) => r.id)).toEqual([jobs.network, jobs.soc]);
    expect(Number(rows[0].total_count)).toBe(2);
  });

  it("filters by search text and work arrangement", async () => {
    await db.asAnon(async (q) => {
      expect((await q("select id from public.get_published_jobs(p_query => 'security')")).map((r) => r.id)).toEqual([
        jobs.soc,
      ]);
      expect(
        (await q("select id from public.get_published_jobs(p_work_arrangement => 'hybrid')")).map((r) => r.id),
      ).toEqual([jobs.network]);
      expect(await q("select id from public.get_published_jobs(p_query => 'Cloud Architect')")).toHaveLength(0);
    });
  });

  it("treats LIKE wildcards in search text literally", async () => {
    await db.asAnon(async (q) => {
      // A bare "%" matches only the title that literally contains "%", not every job.
      expect((await q("select id from public.get_published_jobs(p_query => '%')")).map((r) => r.id)).toEqual([
        jobs.soc,
      ]);
      expect((await q("select id from public.get_published_jobs(p_query => '100%')")).map((r) => r.id)).toEqual([
        jobs.soc,
      ]);
      expect(await q("select id from public.get_published_jobs(p_query => '_')")).toHaveLength(0);
    });
  });

  it("returns a published job's public detail but nothing for drafts or paused jobs", async () => {
    await db.asAnon(async (q) => {
      const [detail] = await q("select * from public.get_published_job($1)", [jobs.network]);
      expect(detail.public_description).toBe("Public description");
      expect(Object.values(detail)).not.toContain("INTERNAL client notes");
      expect(await q("select * from public.get_published_job($1)", [jobs.draft])).toHaveLength(0);
      expect(await q("select * from public.get_published_job($1)", [jobs.paused])).toHaveLength(0);
    });
  });
});

describe("leads", () => {
  it("cannot be read or written by anonymous visitors", async () => {
    await db.asAnon(async (q) => {
      await expect(q("select id from public.leads")).rejects.toThrow(/permission denied/);
      await expect(
        q(
          `insert into public.leads (organization_id, type, full_name, email, consent_at)
           values ($1, 'contact', 'Spam', 'spam@example.test', now())`,
          [org],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("cannot be inserted or read by candidates or employers", async () => {
    for (const user of [candidate, employer]) {
      await db.asUser(user, async (q) => {
        expect(await q("select id from public.leads")).toHaveLength(0);
        await expect(
          q(
            `insert into public.leads (organization_id, type, full_name, email, consent_at)
             values ($1, 'contact', 'X', 'x@example.test', now())`,
            [org],
          ),
        ).rejects.toThrow(/permission denied/);
      });
    }
  });

  it("are visible to staff, who can change only the status, and status changes are audited", async () => {
    await db.asUser(recruiter, async (q) => {
      expect((await q("select id from public.leads")).map((r) => r.id)).toEqual([leadId]);
      await q("update public.leads set status = 'in_progress' where id = $1", [leadId]);
      await expect(q("update public.leads set email = 'changed@example.test' where id = $1", [leadId])).rejects.toThrow(
        /permission denied/,
      );
      await expect(q("delete from public.leads where id = $1", [leadId])).rejects.toThrow(/permission denied/);
    });
    const audit = await db.admin("select action, actor_id, details from public.audit_log where entity_id = $1", [leadId]);
    expect(audit).toEqual([
      { action: "lead.status_changed", actor_id: recruiter, details: { from: "new", to: "in_progress" } },
    ]);
  });

  it("require company and role for employer requests", async () => {
    await expect(
      db.admin(
        `insert into public.leads (organization_id, type, full_name, email, consent_at)
         values ($1, 'employer', 'No Company', 'n@example.test', now())`,
        [org],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
