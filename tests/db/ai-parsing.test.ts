import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type Query, type TestDb } from "./harness";

let db: TestDb;
let org: string;
let admin: string;
let recruiter: string;
let recruiter2: string;
let employer: string;
let candidateUser: string;
let candidate: string;
let parse: string;

const begin = (q: Query, hourly = 3, monthly = 100, tokens: number | null = null) =>
  q("select public.begin_resume_parse($1, null, 'openai', 'test-model', 4000, $2, $3, $4) as id", [candidate, hourly, monthly, tokens]).then(
    (rows) => rows[0].id as string,
  );

beforeAll(async () => {
  db = await createTestDb();
  [{ id: org }] = (await db.admin("select id from public.organizations where is_default")) as { id: string }[];
  admin = await db.createUser("admin@coretech.test");
  await db.grantRole(admin, "admin");
  recruiter = await db.createUser("r1@coretech.test", { appMeta: { invited: true } });
  recruiter2 = await db.createUser("r2@coretech.test", { appMeta: { invited: true } });
  employer = await db.createUser("e@company.test", { appMeta: { invited: true } });
  candidateUser = await db.createUser("cand@example.test");
  await db.asUser(admin, async (q) => {
    await q("select public.assign_role($1, 'recruiter')", [recruiter]);
    await q("select public.assign_role($1, 'recruiter')", [recruiter2]);
    await q("select public.assign_role($1, 'employer')", [employer]);
  });
  await db.asUser(recruiter, async (q) => {
    [{ id: candidate }] = (await q(
      "insert into public.candidates (organization_id, first_name, last_name, created_by) values ($1, 'Pat', 'Demo', auth.uid()) returning id",
      [org],
    )) as { id: string }[];
  });
});

describe("resume parse lifecycle", () => {
  it("logs a request, its result and the recruiter's decision", async () => {
    await db.asUser(recruiter, async (q) => {
      parse = await begin(q);
      await q("select public.finish_resume_parse($1, $2::jsonb, 1200, 300, null)", [parse, JSON.stringify({ skills: [{ name: "BGP" }] })]);
      await expect(q("select public.finish_resume_parse($1, null, 1, 1, null)", [parse])).rejects.toThrow(/not found/);
      await q("select public.review_resume_parse($1, 'applied', $2::jsonb)", [parse, JSON.stringify({ skills: 1 })]);
      await expect(q("select public.review_resume_parse($1, 'discarded', null)", [parse])).rejects.toThrow(/already reviewed/);
    });
    const [row] = await db.admin("select status, input_tokens, output_tokens, reviewed_by from public.resume_parses where id = $1", [parse]);
    expect(row).toEqual({ status: "applied", input_tokens: 1200, output_tokens: 300, reviewed_by: recruiter });
    const audits = await db.admin("select action from public.audit_log where entity_id = $1 order by id", [candidate]);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["ai.resume_parse_requested", "ai.resume_parse_applied"]));
  });

  it("records failures without a proposal", async () => {
    await db.asUser(recruiter, async (q) => {
      const id = await begin(q);
      await q("select public.finish_resume_parse($1, null, null, null, 'Provider timed out')", [id]);
      const [row] = await q("select status, proposal, error from public.resume_parses where id = $1", [id]);
      expect(row).toEqual({ status: "failed", proposal: null, error: "Provider timed out" });
      await expect(q("select public.review_resume_parse($1, 'applied', null)", [id])).rejects.toThrow(/already reviewed/);
    });
  });

  it("lets only the requester finish their own request", async () => {
    let id = "";
    await db.asUser(recruiter2, async (q) => {
      id = await begin(q);
    });
    await db.asUser(recruiter, async (q) => {
      await expect(q("select public.finish_resume_parse($1, '{}'::jsonb, 1, 1, null)", [id])).rejects.toThrow(/not found/);
    });
  });
});

describe("limits", () => {
  it("enforces the per-person hourly limit, counting failures", async () => {
    await db.asUser(recruiter, async (q) => {
      await begin(q, 3); // third request this hour for recruiter
      await expect(begin(q, 3)).rejects.toThrow(/hourly limit/);
    });
    await db.asUser(recruiter2, async (q) => {
      await begin(q, 3); // other people aren't affected
    });
  });

  it("enforces the monthly request cap and token budget for the organization", async () => {
    await db.asUser(admin, async (q) => {
      await expect(begin(q, 100, 5)).rejects.toThrow(/monthly AI parsing limit/);
      await expect(begin(q, 100, 100, 1000)).rejects.toThrow(/token budget/);
      await begin(q, 100, 100, 100000);
    });
  });
});

describe("access", () => {
  it("is staff-only", async () => {
    for (const user of [employer, candidateUser]) {
      await db.asUser(user, async (q) => {
        await expect(begin(q)).rejects.toThrow(/not found/);
        expect(await q("select id from public.resume_parses")).toHaveLength(0);
      });
    }
    await db.asAnon(async (q) => {
      await expect(q("select id from public.resume_parses")).rejects.toThrow(/permission denied/);
    });
  });

  it("reports this month's usage to staff", async () => {
    await db.asUser(recruiter, async (q) => {
      const [u] = await q("select * from public.ai_usage_this_month()");
      // 3 by recruiter (incl. 1 failed), 2 by recruiter2, 1 by admin; refused requests aren't logged.
      expect(u.requests).toBe(6);
      expect(u.failed).toBe(1);
      expect(Number(u.tokens)).toBe(1500);
    });
    await db.asUser(employer, async (q) => {
      const [u] = await q("select * from public.ai_usage_this_month()");
      expect([u.requests, u.failed, Number(u.tokens)]).toEqual([0, 0, 0]);
    });
  });
});
