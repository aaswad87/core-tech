import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type Query, type TestDb } from "./harness";

let db: TestDb;
let org: string;
let admin: string;
let recruiter: string;
let employerA: string;
let employerB: string;
let candidateUser: string;
let otherCandidateUser: string;
let companyA: string;
let companyB: string;
let jobA: string;
let application: string;
let submission: string;
let screen: string;
let client: string;

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const ZOOM = "https://zoom.example/j/123";

async function schedule(q: Query, kind: string, startsAt: string, extra: { requestId?: string; format?: string; url?: string | null; location?: string | null } = {}) {
  const [row] = await q(
    `select public.schedule_interview($1, $2::public.interview_kind, $3::public.interview_format, $4::timestamptz, 45, 'America/Chicago', $5, $6, 'Jordan (Hiring manager)', 'Bring questions', $7) as id`,
    [application, kind, extra.format ?? "video", startsAt, extra.url === undefined ? ZOOM : extra.url, extra.location ?? null, extra.requestId ?? null],
  );
  return row.id as string;
}

beforeAll(async () => {
  db = await createTestDb();
  [{ id: org }] = (await db.admin("select id from public.organizations where is_default")) as { id: string }[];
  admin = await db.createUser("admin@coretech.test");
  await db.grantRole(admin, "admin");
  recruiter = await db.createUser("r@coretech.test", { appMeta: { invited: true } });
  employerA = await db.createUser("a@company-a.test", { appMeta: { invited: true }, userMeta: { full_name: "Avery A" } });
  employerB = await db.createUser("b@company-b.test", { appMeta: { invited: true } });
  candidateUser = await db.createUser("cand@example.test", { userMeta: { full_name: "Casey Demo" } });
  otherCandidateUser = await db.createUser("other@example.test");
  await db.asUser(admin, async (q) => {
    await q("select public.assign_role($1, 'recruiter')", [recruiter]);
    await q("select public.assign_role($1, 'employer')", [employerA]);
    await q("select public.assign_role($1, 'employer')", [employerB]);
  });

  await db.asUser(recruiter, async (q) => {
    [{ id: companyA }] = (await q("insert into public.companies (organization_id, name, created_by) values ($1, 'Company A', auth.uid()) returning id", [org])) as { id: string }[];
    [{ id: companyB }] = (await q("insert into public.companies (organization_id, name, created_by) values ($1, 'Company B', auth.uid()) returning id", [org])) as { id: string }[];
    await q("select public.add_company_member($1, $2, 'owner')", [companyA, employerA]);
    await q("select public.add_company_member($1, $2, 'owner')", [companyB, employerB]);
    [{ id: jobA }] = (await q(
      "insert into public.jobs (organization_id, company_id, title, status, created_by) values ($1, $2, 'Network Engineer', 'published', auth.uid()) returning id",
      [org, companyA],
    )) as { id: string }[];
  });
  await db.asUser(candidateUser, async (q) => {
    [{ id: application }] = (await q("select public.apply_to_job($1) as id", [jobA])) as { id: string }[];
  });
});

describe("scheduling", () => {
  it("lets staff schedule a recruiter screen and records the event", async () => {
    await db.asUser(recruiter, async (q) => {
      screen = await schedule(q, "recruiter_screen", future(2));
    });
    const [row] = await db.admin("select status, submission_id, company_id from public.interviews where id = $1", [screen]);
    expect(row).toEqual({ status: "scheduled", submission_id: null, company_id: companyA });
    const events = await db.admin("select action, actor_id from public.interview_events where interview_id = $1", [screen]);
    expect(events).toEqual([{ action: "scheduled", actor_id: recruiter }]);
  });

  it("validates time, time zone, link and address", async () => {
    await db.asUser(recruiter, async (q) => {
      await expect(schedule(q, "technical", new Date(Date.now() - 3_600_000).toISOString())).rejects.toThrow(/future/);
      await expect(schedule(q, "technical", future(2), { url: null })).rejects.toThrow(/meeting link/);
      await expect(schedule(q, "technical", future(2), { format: "onsite", url: null })).rejects.toThrow(/address/);
      await expect(schedule(q, "technical", future(2), { url: "http://insecure.example" })).rejects.toThrow();
      await expect(
        q(
          "select public.schedule_interview($1, 'technical', 'phone', $2::timestamptz, 30, 'Mars/Base', null, null, null, null)",
          [application, future(2)],
        ),
      ).rejects.toThrow(/time zone/);
    });
  });

  it("requires a submission before a client interview, then links the employer's request", async () => {
    await db.asUser(recruiter, async (q) => {
      await expect(schedule(q, "client", future(3))).rejects.toThrow(/Submit the candidate/);
      [{ id: submission }] = (await q("select public.submit_application_to_client($1, 'Casey D.', 'Strong BGP', true) as id", [application])) as { id: string }[];
    });
    let requestId = "";
    await db.asUser(employerA, async (q) => {
      [{ id: requestId }] = (await q(
        "select public.request_interview($1, 'video', 60, 'America/Chicago', array[$2::timestamptz], null, null) as id",
        [submission, future(4)],
      )) as { id: string }[];
    });
    await db.asUser(recruiter, async (q) => {
      client = await schedule(q, "client", future(4), { requestId });
    });
    const [req] = await db.admin("select status, confirmed_time is not null as confirmed from public.interview_requests where id = $1", [requestId]);
    expect(req).toEqual({ status: "scheduled", confirmed: true });
    const [row] = await db.admin("select submission_id from public.interviews where id = $1", [client]);
    expect(row.submission_id).toBe(submission);
  });

  it("is staff-only", async () => {
    for (const user of [employerA, candidateUser]) {
      await db.asUser(user, async (q) => {
        await expect(schedule(q, "recruiter_screen", future(2))).rejects.toThrow(/not found/);
        await expect(q("select public.cancel_scheduled_interview($1, 'x')", [screen])).rejects.toThrow(/not found/);
        await expect(q("update public.interviews set status = 'cancelled' where id = $1 returning id", [screen])).rejects.toThrow(/permission denied/);
      });
    }
  });
});

describe("rescheduling, cancelling and outcomes", () => {
  it("reschedules with a reason and keeps the history", async () => {
    const newTime = future(5);
    await db.asUser(recruiter, async (q) => {
      await expect(q("select public.reschedule_interview($1, $2::timestamptz, null, 'America/Chicago', $3, null, '')", [client, newTime, ZOOM])).rejects.toThrow(/reason/);
      await q("select public.reschedule_interview($1, $2::timestamptz, 60, 'America/New_York', $3, null, 'Hiring manager travelling')", [client, newTime, ZOOM]);
    });
    const events = await db.admin("select action, reason from public.interview_events where interview_id = $1 order by id", [client]);
    expect(events.map((e) => e.action)).toEqual(["scheduled", "rescheduled"]);
    const [req] = await db.admin("select r.confirmed_time = $2::timestamptz as moved from public.interview_requests r join public.interviews i on i.interview_request_id = r.id where i.id = $1", [client, newTime]);
    expect(req.moved).toBe(true);
  });

  it("only records an outcome once the interview has started, and never on a cancelled one", async () => {
    await db.asUser(recruiter, async (q) => {
      await expect(q("select public.record_interview_outcome($1, 'completed', 'advance', null)", [screen])).rejects.toThrow(/hasn't started/);
    });
    await db.admin("update public.interviews set starts_at = now() - interval '1 hour' where id = $1", [screen]);
    await db.asUser(recruiter, async (q) => {
      await expect(q("select public.record_interview_outcome($1, 'no_show', 'advance', null)", [screen])).rejects.toThrow(/no-show/);
      await q("select public.record_interview_outcome($1, 'completed', 'advance', 'Strong routing knowledge')", [screen]);
    });
    const [row] = await db.admin("select status, outcome from public.interviews where id = $1", [screen]);
    expect(row).toEqual({ status: "completed", outcome: "advance" });
  });

  it("cancels with a reason", async () => {
    let extra = "";
    await db.asUser(recruiter, async (q) => {
      extra = await schedule(q, "technical", future(6));
      await expect(q("select public.cancel_scheduled_interview($1, ' ')", [extra])).rejects.toThrow(/reason/);
      await q("select public.cancel_scheduled_interview($1, 'Candidate asked to pause')", [extra]);
      await expect(q("select public.reschedule_interview($1, $2::timestamptz, null, 'America/Chicago', $3, null, 'x')", [extra, future(7), ZOOM])).rejects.toThrow(/Only scheduled/);
    });
  });
});

describe("what candidates and employers can see", () => {
  it("shows the candidate their own interviews without internal fields", async () => {
    await db.asUser(candidateUser, async (q) => {
      const rows = await q("select * from public.my_interviews()");
      expect(rows).toHaveLength(3);
      expect(Object.keys(rows[0])).not.toEqual(expect.arrayContaining(["outcome", "outcome_summary", "interviewers"]));
      const clientRow = rows.find((r) => r.id === client)!;
      expect(clientRow.company_name).toBe("Company A");
      expect(rows.find((r) => r.id === screen)!.company_name).toBeNull();
      expect(await q("select id from public.interviews")).toHaveLength(0);
      expect(await q("select id from public.interview_events")).toHaveLength(0);
    });
    await db.asUser(otherCandidateUser, async (q) => {
      expect(await q("select * from public.my_interviews()")).toHaveLength(0);
    });
  });

  it("shows the employer only client interviews for their company", async () => {
    await db.asUser(employerA, async (q) => {
      const rows = await q("select id, candidate_display_name from public.company_interviews($1)", [companyA]);
      expect(rows).toEqual([{ id: client, candidate_display_name: "Casey D." }]);
      expect(await q("select id from public.interviews")).toHaveLength(0);
    });
    await db.asUser(employerB, async (q) => {
      expect(await q("select id from public.company_interviews($1)", [companyA])).toHaveLength(0);
      expect(await q("select id from public.company_interviews($1)", [companyB])).toHaveLength(0);
    });
  });

  it("takes employer feedback on client interviews only, and hides it from the candidate", async () => {
    await db.asUser(employerA, async (q) => {
      await q("select public.add_interview_feedback($1, 4::smallint, 'yes', 'Clear communicator')", [client]);
      await expect(q("select public.add_interview_feedback($1, 4::smallint, 'yes', 'x')", [screen])).rejects.toThrow(/not found/);
      const rows = await q("select author_kind, author_name from public.interview_feedback_with_authors($1)", [client]);
      expect(rows).toEqual([{ author_kind: "employer", author_name: "Avery A" }]);
    });
    await db.asUser(employerB, async (q) => {
      await expect(q("select public.add_interview_feedback($1, 1::smallint, 'no', 'x')", [client])).rejects.toThrow(/not found/);
      expect(await q("select * from public.interview_feedback_with_authors($1)", [client])).toHaveLength(0);
    });
    await db.asUser(candidateUser, async (q) => {
      expect(await q("select * from public.interview_feedback_with_authors($1)", [client])).toHaveLength(0);
      expect(await q("select id from public.interview_feedback")).toHaveLength(0);
    });
    await db.asUser(recruiter, async (q) => {
      await q("select public.add_interview_feedback($1, null, null, 'Internal debrief')", [client]);
      expect(await q("select id from public.interview_feedback")).toHaveLength(2);
    });
  });
});

describe("email delivery log", () => {
  it("lets staff log attempts against a real interview only", async () => {
    await db.asUser(recruiter, async (q) => {
      await q("select public.log_interview_email($1, 'cand@example.test', 'Interview scheduled', 'sent', 'msg_1', null)", [client]);
      await expect(q("select public.log_interview_email($1, 'x@y.z', 's', 'sent', null, null)", [crypto.randomUUID()])).rejects.toThrow(/not found/);
      await expect(q("select public.log_interview_email($1, 'x@y.z', 's', 'delivered', null, null)", [client])).rejects.toThrow();
    });
    await db.asUser(employerA, async (q) => {
      await expect(q("select public.log_interview_email($1, 'x@y.z', 's', 'sent', null, null)", [client])).rejects.toThrow(/not found/);
    });
    const rows = await db.admin("select related_type, status from public.notification_deliveries where related_id = $1", [client]);
    expect(rows).toEqual([{ related_type: "interview", status: "sent" }]);
  });
});
