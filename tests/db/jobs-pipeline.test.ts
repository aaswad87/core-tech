import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type Query, type TestDb } from "./harness";

let db: TestDb;
let org: string;
let admin: string;
let recruiter: string;
let employerA: string;
let employerB: string;
let candidateUser: string;
let companyA: string;
let companyB: string;
let job: string;
let draftJob: string;
let candidate: string;

async function newApplication(q: Query, candidateId: string, jobId: string) {
  const [row] = await q(
    `insert into public.applications (organization_id, candidate_id, job_id, source, created_by)
     values ($1, $2, $3, 'recruiter', auth.uid()) returning id`,
    [org, candidateId, jobId],
  );
  return row.id as string;
}

async function newCandidate(q: Query, first: string) {
  const [row] = await q(
    "insert into public.candidates (organization_id, first_name, last_name, created_by) values ($1, $2, 'Demo', auth.uid()) returning id",
    [org, first],
  );
  return row.id as string;
}

const events = (appId: string) =>
  db.admin("select from_stage, to_stage, reason, actor_id from public.application_stage_events where application_id = $1 order by id", [appId]);

beforeAll(async () => {
  db = await createTestDb();
  [{ id: org }] = (await db.admin("select id from public.organizations where is_default")) as { id: string }[];
  admin = await db.createUser("admin@coretech.test");
  await db.grantRole(admin, "admin");
  recruiter = await db.createUser("r@coretech.test", { appMeta: { invited: true } });
  employerA = await db.createUser("a@company-a.test", { appMeta: { invited: true } });
  employerB = await db.createUser("b@company-b.test", { appMeta: { invited: true } });
  candidateUser = await db.createUser("jordan@example.test", { userMeta: { full_name: "Jordan Lee Rivera" } });
  await db.asUser(admin, async (q) => {
    await q("select public.assign_role($1, 'recruiter')", [recruiter]);
    await q("select public.assign_role($1, 'employer')", [employerA]);
    await q("select public.assign_role($1, 'employer')", [employerB]);
  });

  await db.asUser(recruiter, async (q) => {
    [{ id: companyA }] = (await q(
      "insert into public.companies (organization_id, name, created_by) values ($1, 'Company A', auth.uid()) returning id",
      [org],
    )) as { id: string }[];
    [{ id: companyB }] = (await q(
      "insert into public.companies (organization_id, name, created_by) values ($1, 'Company B', auth.uid()) returning id",
      [org],
    )) as { id: string }[];
    await q("select public.add_company_member($1, $2)", [companyA, employerA]);
    await q("select public.add_company_member($1, $2)", [companyB, employerB]);

    [{ id: job }] = (await q(
      `insert into public.jobs (organization_id, company_id, title, status, required_skills, preferred_skills, owner_id, created_by)
       values ($1, $2, 'Network Engineer', 'published', array['BGP','OSPF'], array['Python'], auth.uid(), auth.uid()) returning id`,
      [org, companyA],
    )) as { id: string }[];
    [{ id: draftJob }] = (await q(
      "insert into public.jobs (organization_id, company_id, title, created_by) values ($1, $2, 'Draft Role', auth.uid()) returning id",
      [org, companyA],
    )) as { id: string }[];
    candidate = await newCandidate(q, "Alex");
  });
});

describe("jobs", () => {
  it("stamps published_at automatically and exposes skills publicly", async () => {
    const [row] = await db.admin("select published_at from public.jobs where id = $1", [job]);
    expect(row.published_at).not.toBeNull();
    const [pub] = await db.asAnon((q) => q("select required_skills, preferred_skills from public.get_published_job($1)", [job]));
    expect(pub).toEqual({ required_skills: ["BGP", "OSPF"], preferred_skills: ["Python"] });
  });

  it("audits status changes and only allows staff owners", async () => {
    await db.asUser(recruiter, (q) => q("update public.jobs set status = 'paused' where id = $1", [draftJob]));
    const audit = await db.admin("select details from public.audit_log where action = 'job.status_changed' and entity_id = $1", [draftJob]);
    expect(audit).toEqual([{ details: { from: "draft", to: "paused" } }]);
    await db.asUser(recruiter, async (q) => {
      await expect(q("update public.jobs set owner_id = $2 where id = $1", [draftJob, employerA])).rejects.toThrow(/owner must be/);
    });
  });

  it("rejects invalid skill lists", async () => {
    await db.asUser(recruiter, async (q) => {
      await expect(q("update public.jobs set required_skills = array[' padded'] where id = $1", [draftJob])).rejects.toThrow(/check/);
    });
  });
});

describe("candidates applying", () => {
  it("creates the candidate record on first application and blocks duplicates", async () => {
    const appId = await db.asUser(candidateUser, async (q) => (await q("select public.apply_to_job($1) as id", [job]))[0].id as string);
    const [c] = await db.admin("select first_name, last_name, email, source from public.candidates where user_id = $1", [candidateUser]);
    expect(c).toEqual({ first_name: "Jordan", last_name: "Lee Rivera", email: "jordan@example.test", source: "Candidate portal" });
    expect(await events(appId)).toEqual([
      { from_stage: null, to_stage: "new", reason: "Applied through the website", actor_id: candidateUser },
    ]);

    await db.asUser(candidateUser, async (q) => {
      await expect(q("select public.apply_to_job($1)", [job])).rejects.toThrow(/already have an active application/);
      expect(await q("select id from public.applications")).toHaveLength(0);
      expect((await q("select status_label from public.my_applications()")).map((r) => r.status_label)).toHaveLength(1);
    });
  });

  it("only lets candidate accounts apply, and only to published jobs", async () => {
    await db.asUser(candidateUser, async (q) => {
      await expect(q("select public.apply_to_job($1)", [draftJob])).rejects.toThrow(/no longer accepting/);
    });
    for (const user of [recruiter, employerA]) {
      await db.asUser(user, async (q) => {
        await expect(q("select public.apply_to_job($1)", [job])).rejects.toThrow(/Only candidate accounts/);
      });
    }
    await db.asAnon(async (q) => {
      await expect(q("select public.apply_to_job($1)", [job])).rejects.toThrow(/permission denied/);
    });
  });

  it("lets a candidate withdraw only their own active application and hides stage reasons from them", async () => {
    const [{ id: appId }] = (await db.admin(
      "select a.id from public.applications a join public.candidates c on c.id = a.candidate_id where c.user_id = $1",
      [candidateUser],
    )) as { id: string }[];
    await db.asUser(recruiter, async (q) => {
      await expect(q("select public.withdraw_my_application($1)", [appId])).rejects.toThrow(/not found/);
    });
    await db.asUser(candidateUser, async (q) => {
      await q("select public.withdraw_my_application($1)", [appId]);
      await expect(q("select public.withdraw_my_application($1)", [appId])).rejects.toThrow(/already closed/);
      expect(await q("select 1 from public.application_stage_events")).toHaveLength(0);
      // Withdrawn frees the candidate to apply again.
      await q("select public.apply_to_job($1)", [job]);
      const mine = await q("select job_title, status_label, can_withdraw from public.my_applications()");
      expect(mine).toEqual([
        { job_title: "Network Engineer", status_label: "In progress", can_withdraw: true },
        { job_title: "Network Engineer", status_label: "Withdrawn", can_withdraw: false },
      ]);
      expect(Object.keys((await q("select * from public.my_applications()"))[0])).not.toContain("stage");
    });
    // Other users see none of this candidate's applications through the function.
    expect(await db.asUser(employerA, (q) => q("select * from public.my_applications()"))).toHaveLength(0);
  });
});

describe("pipeline stage changes", () => {
  it("records actor, previous and new stage, and reason", async () => {
    const appId = await db.asUser(recruiter, (q) => newApplication(q, candidate, job));
    await db.asUser(recruiter, async (q) => {
      await q("select public.move_application_stage($1, 'screening')", [appId]);
      await q("select public.move_application_stage($1, 'recruiter_interview', 'Strong BGP background')", [appId]);
      // Moving to the same stage is a no-op.
      await q("select public.move_application_stage($1, 'recruiter_interview')", [appId]);
    });
    expect(await events(appId)).toEqual([
      { from_stage: null, to_stage: "new", reason: "Added by a recruiter", actor_id: recruiter },
      { from_stage: "new", to_stage: "screening", reason: null, actor_id: recruiter },
      { from_stage: "screening", to_stage: "recruiter_interview", reason: "Strong BGP background", actor_id: recruiter },
    ]);
  });

  it("requires a reason for rejected, withdrawn, on hold and future opportunity", async () => {
    const appId = await db.asUser(recruiter, async (q) => newApplication(q, await newCandidate(q, "Reason"), job));
    await db.asUser(recruiter, async (q) => {
      for (const stage of ["rejected", "withdrawn", "on_hold", "future_opportunity"]) {
        await expect(q(`select public.move_application_stage($1, '${stage}', '  ')`, [appId])).rejects.toThrow(/reason is required/);
      }
      await q("select public.move_application_stage($1, 'rejected', 'Missing required BGP experience')", [appId]);
    });
    const [row] = await db.admin("select stage, status from public.applications where id = $1", [appId]);
    expect(row).toEqual({ stage: "rejected", status: "closed" });
    expect(await db.admin("select 1 from public.audit_log where action = 'application.stage_changed' and entity_id = $1", [appId])).toHaveLength(1);
  });

  it("blocks direct stage edits and non-staff moves", async () => {
    const appId = await db.asUser(recruiter, async (q) => newApplication(q, await newCandidate(q, "Direct"), job));
    await db.asUser(recruiter, async (q) => {
      await expect(q("update public.applications set stage = 'offer' where id = $1", [appId])).rejects.toThrow(/permission denied/);
    });
    for (const user of [employerA, candidateUser]) {
      await db.asUser(user, async (q) => {
        await expect(q("select public.move_application_stage($1, 'screening')", [appId])).rejects.toThrow(/not found/);
      });
    }
  });

  it("only allows Submitted to Client with recorded consent, creating a submission only that employer sees", async () => {
    const appId = await db.asUser(recruiter, async (q) => newApplication(q, await newCandidate(q, "Sam"), job));
    await db.asUser(recruiter, async (q) => {
      await expect(q("select public.move_application_stage($1, 'submitted_to_client')", [appId])).rejects.toThrow(/consent/);
      await expect(q("select public.submit_application_to_client($1, 'Sam D.', 'Summary', false)", [appId])).rejects.toThrow(
        /candidate agreed/,
      );
      await q("select public.submit_application_to_client($1, 'Sam D.', 'Strong network background', true)", [appId]);
      await expect(q("select public.submit_application_to_client($1, 'Sam D.', 'Again', true)", [appId])).rejects.toThrow(/duplicate|unique/);
    });
    const subsA = await db.asUser(employerA, (q) => q("select candidate_display_name, shared_summary from public.submissions"));
    expect(subsA).toEqual([{ candidate_display_name: "Sam D.", shared_summary: "Strong network background" }]);
    expect(await db.asUser(employerB, (q) => q("select 1 from public.submissions"))).toHaveLength(0);
    expect(await db.asUser(employerA, (q) => q("select 1 from public.applications"))).toHaveLength(0);
    expect(await db.asUser(employerA, (q) => q("select 1 from public.application_stage_events"))).toHaveLength(0);
    const [row] = await db.admin("select stage from public.applications where id = $1", [appId]);
    expect(row.stage).toBe("submitted_to_client");
  });

  it("only lets an administrator move a candidate out of Placed", async () => {
    const appId = await db.asUser(recruiter, async (q) => newApplication(q, await newCandidate(q, "Placed"), job));
    await db.asUser(recruiter, async (q) => {
      await q("select public.move_application_stage($1, 'offer')", [appId]);
      await q("select public.move_application_stage($1, 'placed')", [appId]);
      await expect(q("select public.move_application_stage($1, 'offer')", [appId])).rejects.toThrow(/Only an administrator/);
    });
    await db.asUser(admin, (q) => q("select public.move_application_stage($1, 'offer', 'Start date fell through')", [appId]));
    const [row] = await db.admin("select stage, status from public.applications where id = $1", [appId]);
    expect(row).toEqual({ stage: "offer", status: "active" });
  });

  it("does not allow two active applications for the same candidate and job", async () => {
    await db.asUser(recruiter, async (q) => {
      const c = await newCandidate(q, "Dup");
      await newApplication(q, c, job);
      await expect(newApplication(q, c, job)).rejects.toThrow(/duplicate|unique/);
    });
  });
});
