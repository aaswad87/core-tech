import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type Query, type TestDb } from "./harness";

let db: TestDb;
let org: string;
let admin: string;
let recruiter: string;
let ownerA: string;
let memberA: string;
let ownerB: string;
let candidateUser: string;
let companyA: string;
let companyB: string;
let jobA: string;
let jobB: string;
let candidateX: string;
let candidateY: string;
let submissionA: string;
let submissionB: string;
let resumeX: string;
let resumeXPath: string;
let resumeY: string;

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

async function newCandidate(q: Query, first: string) {
  const [row] = await q(
    "insert into public.candidates (organization_id, first_name, last_name, created_by) values ($1, $2, 'Demo', auth.uid()) returning id",
    [org, first],
  );
  return row.id as string;
}

async function submit(q: Query, candidateId: string, jobId: string, name: string) {
  const [app] = await q(
    `insert into public.applications (organization_id, candidate_id, job_id, source, created_by)
     values ($1, $2, $3, 'recruiter', auth.uid()) returning id`,
    [org, candidateId, jobId],
  );
  const [row] = await q("select public.submit_application_to_client($1, $2, 'Strong BGP background', true) as id", [app.id, name]);
  return row.id as string;
}

async function addResume(q: Query, candidateId: string, n: number) {
  const path = `${org}/${candidateId}/r${n}.pdf`;
  await q("insert into storage.objects (bucket_id, name) values ('resumes', $1)", [path]);
  const [row] = await q(
    `insert into public.candidate_resumes (organization_id, candidate_id, storage_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
     values ($1, $2, $3, 'resume.pdf', 'application/pdf', 100, $4, auth.uid()) returning id`,
    [org, candidateId, path, n.toString(16).padStart(64, "0")],
  );
  return { id: row.id as string, path };
}

beforeAll(async () => {
  db = await createTestDb();
  [{ id: org }] = (await db.admin("select id from public.organizations where is_default")) as { id: string }[];
  admin = await db.createUser("admin@coretech.test");
  await db.grantRole(admin, "admin");
  recruiter = await db.createUser("r@coretech.test", { appMeta: { invited: true } });
  ownerA = await db.createUser("owner@company-a.test", { appMeta: { invited: true }, userMeta: { full_name: "Avery Owner" } });
  memberA = await db.createUser("member@company-a.test", { appMeta: { invited: true }, userMeta: { full_name: "Morgan Member" } });
  ownerB = await db.createUser("owner@company-b.test", { appMeta: { invited: true } });
  candidateUser = await db.createUser("cand@example.test");
  await db.asUser(admin, async (q) => {
    await q("select public.assign_role($1, 'recruiter')", [recruiter]);
    for (const u of [ownerA, memberA, ownerB]) await q("select public.assign_role($1, 'employer')", [u]);
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
    await q("select public.add_company_member($1, $2, 'owner')", [companyA, ownerA]);
    await q("select public.add_company_member($1, $2, 'member')", [companyA, memberA]);
    await q("select public.add_company_member($1, $2, 'owner')", [companyB, ownerB]);

    [{ id: jobA }] = (await q(
      "insert into public.jobs (organization_id, company_id, title, status, created_by) values ($1, $2, 'Network Engineer', 'published', auth.uid()) returning id",
      [org, companyA],
    )) as { id: string }[];
    [{ id: jobB }] = (await q(
      "insert into public.jobs (organization_id, company_id, title, status, created_by) values ($1, $2, 'SOC Analyst', 'published', auth.uid()) returning id",
      [org, companyB],
    )) as { id: string }[];

    candidateX = await newCandidate(q, "Xavier");
    candidateY = await newCandidate(q, "Yara");
    await q("insert into public.candidate_notes (organization_id, candidate_id, author_id, body) values ($1, $2, auth.uid(), 'Internal only')", [org, candidateX]);
    submissionA = await submit(q, candidateX, jobA, "Xavier D.");
    submissionB = await submit(q, candidateY, jobB, "Yara D.");
    ({ id: resumeX, path: resumeXPath } = await addResume(q, candidateX, 1));
    ({ id: resumeY } = await addResume(q, candidateY, 2));
  });
});

describe("company isolation", () => {
  it("shows each employer only their own company, jobs and submissions", async () => {
    await db.asUser(ownerA, async (q) => {
      expect(await q("select id from public.companies")).toEqual([{ id: companyA }]);
      expect(await q("select id from public.jobs")).toEqual([{ id: jobA }]);
      expect(await q("select id from public.submissions")).toEqual([{ id: submissionA }]);
    });
    await db.asUser(ownerB, async (q) => {
      expect(await q("select id from public.companies")).toEqual([{ id: companyB }]);
      expect(await q("select id from public.submissions")).toEqual([{ id: submissionB }]);
    });
  });

  it("never exposes candidates, notes, applications, pipeline history or resumes metadata", async () => {
    await db.asUser(ownerA, async (q) => {
      for (const table of ["candidates", "candidate_notes", "applications", "application_stage_events", "candidate_resumes", "candidate_activity"]) {
        expect(await q(`select 1 from public.${table}`), table).toHaveLength(0);
      }
    });
  });

  it("rejects every employer action on another company's records", async () => {
    await db.asUser(ownerB, async (q) => {
      await expect(q("select public.update_my_company($1, null, 'x', null, null)", [companyA])).rejects.toThrow(/Only company owners/);
      await expect(q("select * from public.company_team($1)", [companyA])).resolves.toHaveLength(0);
      await expect(
        q("select public.submit_job_request($1, 'Role', null, null, null, 1, null, null, null, 'Need one', null)", [companyA]),
      ).rejects.toThrow(/Only members/);
      await expect(q("select public.respond_to_submission($1, 'declined')", [submissionA])).rejects.toThrow(/not found/);
      await expect(q("select public.add_submission_feedback($1, 1::smallint, 'Bad')", [submissionA])).rejects.toThrow(/not found/);
      await expect(q("select * from public.get_shared_resume($1)", [submissionA])).rejects.toThrow(/not found/);
      await expect(
        q("select public.request_interview($1, 'video', 60, 'America/Chicago', array[$2::timestamptz], null, null)", [submissionA, future(3)]),
      ).rejects.toThrow(/not found/);
    });
  });

  it("does not let employers write tables directly", async () => {
    await db.asUser(ownerA, async (q) => {
      await expect(q("update public.submissions set status = 'hired' where id = $1 returning id", [submissionA])).rejects.toThrow(/permission denied/);
      await expect(q("update public.companies set name = 'Renamed' where id = $1 returning id", [companyA])).resolves.toHaveLength(0);
      await expect(
        q("insert into public.job_requests (organization_id, company_id, title, description) values ($1, $2, 'X', 'Y')", [org, companyA]),
      ).rejects.toThrow(/permission denied/);
      await expect(q("insert into public.submission_feedback (organization_id, submission_id, company_id, body) values ($1, $2, $3, 'x')", [org, submissionA, companyA])).rejects.toThrow(/permission denied/);
    });
  });

  it("loses access when the employer role is revoked", async () => {
    const temp = await db.createUser("temp@company-a.test", { appMeta: { invited: true } });
    await db.asUser(admin, (q) => q("select public.assign_role($1, 'employer')", [temp]));
    await db.asUser(recruiter, (q) => q("select public.add_company_member($1, $2)", [companyA, temp]));
    await db.asUser(temp, async (q) => expect(await q("select id from public.submissions")).toHaveLength(1));
    await db.asUser(admin, (q) => q("select public.revoke_role($1, 'employer')", [temp]));
    await db.asUser(temp, async (q) => expect(await q("select id from public.submissions")).toHaveLength(0));
  });
});

describe("company profile and team", () => {
  it("lets owners, not members, edit the profile (but never the name)", async () => {
    await db.asUser(memberA, async (q) => {
      await expect(q("select public.update_my_company($1, null, 'Telecom', null, null)", [companyA])).rejects.toThrow(/Only company owners/);
    });
    await db.asUser(ownerA, async (q) => {
      await q("select public.update_my_company($1, 'https://a.example', 'Telecom', 'Dallas, TX', 'Fiber builder')", [companyA]);
      await expect(q("select public.update_my_company($1, 'ftp://bad', null, null, null)", [companyA])).rejects.toThrow();
    });
    const [row] = await db.admin("select name, website, industry, headquarters from public.companies where id = $1", [companyA]);
    expect(row).toEqual({ name: "Company A", website: "https://a.example", industry: "Telecom", headquarters: "Dallas, TX" });
  });

  it("shows the team to members and keeps at least one owner", async () => {
    await db.asUser(memberA, async (q) => {
      const team = await q("select full_name, member_role from public.company_team($1)", [companyA]);
      expect(team).toEqual([
        { full_name: "Avery Owner", member_role: "owner" },
        { full_name: "Morgan Member", member_role: "member" },
      ]);
      await expect(q("select public.remove_company_member_as_owner($1, $2)", [companyA, ownerA])).rejects.toThrow(/Only company owners/);
    });
    await db.asUser(ownerA, async (q) => {
      await expect(q("select public.set_company_member_role_as_owner($1, $2, 'member')", [companyA, ownerA])).rejects.toThrow(/at least one owner/);
      await expect(q("select public.remove_company_member_as_owner($1, $2)", [companyA, ownerA])).rejects.toThrow(/at least one owner/);
      await q("select public.set_company_member_role_as_owner($1, $2, 'owner')", [companyA, memberA]);
      await q("select public.set_company_member_role_as_owner($1, $2, 'member')", [companyA, memberA]);
    });
  });

  it("routes teammate requests to staff", async () => {
    await db.asUser(memberA, async (q) => {
      await expect(q("select public.request_company_member($1, 'New Person', 'new@company-a.test', 'member')", [companyA])).rejects.toThrow(/Only company owners/);
    });
    let requestId = "";
    await db.asUser(ownerA, async (q) => {
      [{ id: requestId }] = (await q("select public.request_company_member($1, 'New Person', 'New@Company-A.test', 'member') as id", [companyA])) as { id: string }[];
      await expect(q("select public.request_company_member($1, 'Again', 'new@company-a.test', 'member')", [companyA])).rejects.toThrow(/already pending/);
      await expect(q("select public.handle_company_member_request($1, 'completed')", [requestId])).rejects.toThrow(/not found/);
    });
    await db.asUser(ownerB, async (q) => expect(await q("select id from public.company_member_requests")).toHaveLength(0));
    await db.asUser(recruiter, (q) => q("select public.handle_company_member_request($1, 'completed')", [requestId]));
    const [row] = await db.admin("select email, status from public.company_member_requests where id = $1", [requestId]);
    expect(row).toEqual({ email: "new@company-a.test", status: "completed" });
  });
});

describe("job requests", () => {
  let requestId: string;

  it("lets members request a job and staff convert it into a draft job", async () => {
    await db.asUser(memberA, async (q) => {
      [{ id: requestId }] = (await q(
        "select public.submit_job_request($1, 'Fiber Splicer', 'Austin, TX', 'onsite', 'direct_hire', 2, 60000, 80000, null, 'Splice OSP fiber', 'OTDR') as id",
        [companyA],
      )) as { id: string }[];
      await expect(
        q("select public.submit_job_request($1, 'Bad', null, null, null, 1, 90000, 10000, null, 'x', null)", [companyA]),
      ).rejects.toThrow();
    });
    await db.asUser(ownerB, async (q) => expect(await q("select id from public.job_requests")).toHaveLength(0));
    await db.asUser(ownerA, async (q) => {
      await expect(q("select public.convert_job_request($1)", [requestId])).rejects.toThrow(/not found/);
    });

    let jobId = "";
    await db.asUser(recruiter, async (q) => {
      [{ id: jobId }] = (await q("select public.convert_job_request($1) as id", [requestId])) as { id: string }[];
      await expect(q("select public.review_job_request($1, 'declined', 'Too late')", [requestId])).rejects.toThrow(/already closed/);
    });
    const [job] = await db.admin("select status, company_id, title, owner_id from public.jobs where id = $1", [jobId]);
    expect(job).toEqual({ status: "draft", company_id: companyA, title: "Fiber Splicer", owner_id: recruiter });
    await db.asUser(ownerA, async (q) => {
      expect(await q("select status, job_id from public.job_requests where id = $1", [requestId])).toEqual([{ status: "converted", job_id: jobId }]);
    });
  });

  it("requires a reason to decline and lets the employer cancel open requests", async () => {
    let second = "";
    await db.asUser(ownerA, async (q) => {
      [{ id: second }] = (await q("select public.submit_job_request($1, 'NOC Tech', null, null, null, 1, null, null, null, 'Nights', null) as id", [companyA])) as { id: string }[];
    });
    await db.asUser(recruiter, async (q) => {
      await expect(q("select public.review_job_request($1, 'declined', ' ')", [second])).rejects.toThrow(/why/);
      await q("select public.review_job_request($1, 'in_review', null)", [second]);
    });
    await db.asUser(ownerA, async (q) => {
      await q("select public.cancel_job_request($1)", [second]);
      await expect(q("select public.cancel_job_request($1)", [second])).rejects.toThrow(/already closed/);
    });
  });
});

describe("submissions, shared resumes and feedback", () => {
  it("hides the resume until a recruiter shares one, and only that file", async () => {
    await db.asUser(ownerA, async (q) => {
      expect(await q("select * from public.get_shared_resume($1)", [submissionA])).toHaveLength(0);
      expect(await q("select name from storage.objects where bucket_id = 'resumes'")).toHaveLength(0);
    });
    await db.asUser(recruiter, async (q) => {
      await expect(q("select public.share_resume_with_submission($1, $2)", [submissionA, resumeY])).rejects.toThrow(/different candidate/);
      await q("select public.share_resume_with_submission($1, $2)", [submissionA, resumeX]);
    });
    await db.asUser(ownerA, async (q) => {
      expect(await q("select storage_path from public.get_shared_resume($1)", [submissionA])).toEqual([{ storage_path: resumeXPath }]);
      expect(await q("select name from storage.objects where bucket_id = 'resumes'")).toEqual([{ name: resumeXPath }]);
    });
    await db.asUser(ownerB, async (q) => {
      expect(await q("select name from storage.objects where bucket_id = 'resumes'")).toHaveLength(0);
    });
    const audits = await db.admin("select action from public.audit_log where entity_id = $1 order by id", [submissionA]);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["submission.resume_shared", "submission.resume_viewed"]));
  });

  it("lets employers review, request interviews and leave feedback the candidate can't see", async () => {
    await db.asUser(memberA, async (q) => {
      await q("select public.respond_to_submission($1, 'under_review')", [submissionA]);
      await expect(q("select public.respond_to_submission($1, 'hired')", [submissionA])).rejects.toThrow(/Choose/);
      await q("select public.add_submission_feedback($1, 4::smallint, 'Good fundamentals')", [submissionA]);
      await expect(q("select public.add_submission_feedback($1, 9::smallint, 'x')", [submissionA])).rejects.toThrow();
      const feedback = await q("select author_name, rating from public.submission_feedback_with_authors($1)", [submissionA]);
      expect(feedback).toEqual([{ author_name: "Morgan Member", rating: 4 }]);
    });
    await db.asUser(ownerB, async (q) => expect(await q("select id from public.submission_feedback")).toHaveLength(0));
    await db.asUser(recruiter, async (q) => expect(await q("select id from public.submission_feedback")).toHaveLength(1));
  });

  it("removes resume access once the employer declines", async () => {
    await db.asUser(ownerB, async (q) => {
      await q("select public.respond_to_submission($1, 'declined')", [submissionB]);
      await expect(q("select public.respond_to_submission($1, 'under_review')", [submissionB])).rejects.toThrow(/closed/);
    });
    await db.asUser(recruiter, async (q) => {
      await q("select public.share_resume_with_submission($1, $2)", [submissionB, resumeY]);
    });
    await db.asUser(ownerB, async (q) => {
      expect(await q("select * from public.get_shared_resume($1)", [submissionB])).toHaveLength(0);
      expect(await q("select name from storage.objects where bucket_id = 'resumes'")).toHaveLength(0);
    });
  });
});

describe("interview requests", () => {
  let requestId: string;

  it("lets an employer propose future times and marks the submission", async () => {
    await db.asUser(ownerA, async (q) => {
      await expect(
        q("select public.request_interview($1, 'video', 60, 'America/Chicago', array[$2::timestamptz], null, null)", [submissionA, new Date(Date.now() - 3_600_000).toISOString()]),
      ).rejects.toThrow(/future/);
      [{ id: requestId }] = (await q(
        "select public.request_interview($1, 'video', 45, 'America/Chicago', array[$2::timestamptz, $3::timestamptz], 'Hiring manager', null) as id",
        [submissionA, future(2), future(3)],
      )) as { id: string }[];
      await expect(
        q("select public.request_interview($1, 'phone', 30, 'America/Chicago', array[$2::timestamptz], null, null)", [submissionA, future(4)]),
      ).rejects.toThrow(/already waiting/);
      expect(await q("select status from public.submissions where id = $1", [submissionA])).toEqual([{ status: "interview_requested" }]);
    });
    await db.asUser(ownerB, async (q) => expect(await q("select id from public.interview_requests")).toHaveLength(0));
  });

  it("is confirmed by staff only", async () => {
    await db.asUser(ownerA, async (q) => {
      await expect(q("select public.handle_interview_request($1, 'scheduled', $2, null)", [requestId, future(2)])).rejects.toThrow(/not found/);
    });
    await db.asUser(recruiter, async (q) => {
      await expect(q("select public.handle_interview_request($1, 'scheduled', null, null)", [requestId])).rejects.toThrow(/confirmed time/);
      await q("select public.handle_interview_request($1, 'scheduled', $2, 'Teams link to follow')", [requestId, future(2)]);
    });
    await db.asUser(ownerA, async (q) => {
      const [row] = await q("select status, response_note from public.interview_requests where id = $1", [requestId]);
      expect(row).toEqual({ status: "scheduled", response_note: "Teams link to follow" });
    });
  });

  it("never shows interview requests or feedback to the candidate", async () => {
    await db.asUser(candidateUser, async (q) => {
      for (const table of ["interview_requests", "submission_feedback", "job_requests", "company_member_requests"]) {
        expect(await q(`select 1 from public.${table}`), table).toHaveLength(0);
      }
    });
    await db.asAnon(async (q) => {
      await expect(q("select 1 from public.interview_requests")).rejects.toThrow(/permission denied/);
    });
  });
});
