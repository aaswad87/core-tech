import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./harness";

type Ids = {
  admin: string;
  recruiter: string;
  employerA: string;
  employerB: string;
  candidateUserA: string;
  candidateUserB: string;
  companyA: string;
  companyB: string;
  jobAPublished: string;
  jobADraft: string;
  jobBPublished: string;
  candidateA: string;
  candidateB: string;
  noteA: string;
  submissionA: string;
  submissionB: string;
};

let db: TestDb;
const ids = {} as Ids;

async function expectDenied(promise: Promise<unknown>, pattern: RegExp = /permission denied|row-level security|Only|cannot/i) {
  await expect(promise).rejects.toThrow(pattern);
}

beforeAll(async () => {
  db = await createTestDb();

  ids.admin = await db.createUser("admin@coretech.test");
  await db.grantRole(ids.admin, "admin");

  ids.recruiter = await db.createUser("recruiter@coretech.test", { appMeta: { invited: true } });
  ids.employerA = await db.createUser("hiring@company-a.test", { appMeta: { invited: true } });
  ids.employerB = await db.createUser("hiring@company-b.test", { appMeta: { invited: true } });
  ids.candidateUserA = await db.createUser("candidate.a@example.test");
  ids.candidateUserB = await db.createUser("candidate.b@example.test");

  // Roles are granted through the real admin-only function, not by the test fixture.
  await db.asUser(ids.admin, async (q) => {
    await q("select public.assign_role($1, 'recruiter')", [ids.recruiter]);
    await q("select public.assign_role($1, 'employer')", [ids.employerA]);
    await q("select public.assign_role($1, 'employer')", [ids.employerB]);
  });

  // Submissions are inserted as the database owner after the recruiter session (see `submit`).
  let submitLater: ((candidateId: string, jobId: string, companyId: string, name: string) => Promise<string>) | undefined;
  await db.asUser(ids.recruiter, async (q) => {
    const org = (await q("select organization_id from public.profiles where id = $1", [ids.recruiter]))[0]
      .organization_id as string;

    [ids.companyA, ids.companyB] = await Promise.all(
      ["Company A (demo)", "Company B (demo)"].map(async (name) =>
        (await q(
          "insert into public.companies (organization_id, name, is_demo, created_by) values ($1, $2, true, auth.uid()) returning id",
          [org, name],
        ))[0].id as string,
      ),
    );

    await q("select public.add_company_member($1, $2, 'owner')", [ids.companyA, ids.employerA]);
    await q("select public.add_company_member($1, $2, 'owner')", [ids.companyB, ids.employerB]);

    const insertJob = async (companyId: string, title: string, status: string) =>
      (await q(
        `insert into public.jobs (organization_id, company_id, title, public_summary, description, status,
           published_at, salary_min, salary_max, is_demo, created_by)
         values ($1, $2, $3, 'Public summary', 'Confidential client details', $4::public.job_status,
           case when $4 = 'published' then now() end, 120000, 150000, true, auth.uid())
         returning id`,
        [org, companyId, title, status],
      ))[0].id as string;

    ids.jobAPublished = await insertJob(ids.companyA, "Network Engineer (demo)", "published");
    ids.jobADraft = await insertJob(ids.companyA, "Security Architect (demo)", "draft");
    ids.jobBPublished = await insertJob(ids.companyB, "Cloud Engineer (demo)", "published");

    const insertCandidate = async (userId: string, first: string) =>
      (await q(
        `insert into public.candidates (organization_id, user_id, first_name, last_name, email, is_demo, created_by)
         values ($1, $2, $3, 'Demo', $4, true, auth.uid()) returning id`,
        [org, userId, first, `${first.toLowerCase()}@example.test`],
      ))[0].id as string;

    ids.candidateA = await insertCandidate(ids.candidateUserA, "Alex");
    ids.candidateB = await insertCandidate(ids.candidateUserB, "Blair");

    ids.noteA = (await q(
      "insert into public.candidate_notes (organization_id, candidate_id, author_id, body) values ($1, $2, auth.uid(), 'Internal: salary expectations discussed') returning id",
      [org, ids.candidateA],
    ))[0].id as string;

    // Fixture only: real submissions go through submit_application_to_client() (staff have no direct write).
    const submit = async (candidateId: string, jobId: string, companyId: string, name: string) =>
      (await db.admin(
        `insert into public.submissions (organization_id, candidate_id, job_id, company_id, candidate_display_name,
           shared_summary, candidate_consent_at, submitted_by)
         values ($1, $2, $3, $4, $5, 'Shared summary', now(), $6) returning id`,
        [org, candidateId, jobId, companyId, name, ids.recruiter],
      ))[0].id as string;

    submitLater = submit;
  });
  ids.submissionA = await submitLater!(ids.candidateA, ids.jobAPublished, ids.companyA, "Alex D.");
  ids.submissionB = await submitLater!(ids.candidateB, ids.jobBPublished, ids.companyB, "Blair D.");
});

describe("signup provisioning", () => {
  it("gives a self-registered user a profile and only the candidate role", async () => {
    const roles = await db.admin("select role from public.user_roles where user_id = $1", [ids.candidateUserA]);
    expect(roles.map((r) => r.role)).toEqual(["candidate"]);
    const [profile] = await db.admin("select email from public.profiles where id = $1", [ids.candidateUserA]);
    expect(profile.email).toBe("candidate.a@example.test");
  });

  it("ignores role claims in user-controlled signup metadata", async () => {
    const id = await db.createUser("sneaky@example.test", {
      userMeta: { role: "admin", roles: ["admin"], invited: true, full_name: "Sneaky" },
    });
    const roles = await db.admin("select role from public.user_roles where user_id = $1", [id]);
    expect(roles.map((r) => r.role)).toEqual(["candidate"]);
  });

  it("gives admin-invited users no role until an admin assigns one", async () => {
    const roles = await db.admin("select role from public.user_roles where user_id = $1", [ids.employerA]);
    expect(roles.map((r) => r.role)).toEqual(["employer"]);
  });
});

describe("role assignment", () => {
  it("prevents a candidate from inserting their own role", async () => {
    await db.asUser(ids.candidateUserA, async (q) => {
      await expectDenied(
        q(
          "insert into public.user_roles (user_id, organization_id, role) select id, organization_id, 'admin' from public.profiles where id = auth.uid()",
        ),
      );
    });
  });

  it("prevents a candidate from updating or deleting role rows", async () => {
    await db.asUser(ids.candidateUserA, async (q) => {
      await expectDenied(q("update public.user_roles set role = 'admin' where user_id = auth.uid()"));
      await expectDenied(q("delete from public.user_roles where user_id = auth.uid()"));
    });
  });

  it("prevents non-admins from calling assign_role", async () => {
    for (const actor of [ids.candidateUserA, ids.employerA, ids.recruiter]) {
      await db.asUser(actor, async (q) => {
        await expectDenied(q("select public.assign_role($1, 'admin')", [actor]));
        await expectDenied(q("select public.assign_role($1, 'recruiter')", [ids.candidateUserB]));
      });
    }
  });

  it("prevents an admin from changing their own roles", async () => {
    await db.asUser(ids.admin, async (q) => {
      await expectDenied(q("select public.assign_role($1, 'recruiter')", [ids.admin]));
      await expectDenied(q("select public.revoke_role($1, 'admin')", [ids.admin]));
    });
  });

  it("lets an admin assign and revoke roles and records both in the audit log", async () => {
    const userId = await db.createUser("temp@example.test");
    await db.asUser(ids.admin, async (q) => {
      expect((await q("select public.assign_role($1, 'recruiter') as ok", [userId]))[0].ok).toBe(true);
      expect((await q("select public.assign_role($1, 'recruiter') as ok", [userId]))[0].ok).toBe(false);
      expect((await q("select public.revoke_role($1, 'recruiter') as ok", [userId]))[0].ok).toBe(true);
    });
    const log = await db.admin(
      "select action, actor_id from public.audit_log where entity_id = $1 order by id",
      [userId],
    );
    expect(log).toEqual([
      { action: "role.assigned", actor_id: ids.admin },
      { action: "role.revoked", actor_id: ids.admin },
    ]);
  });

  it("does not let users change system-managed profile fields", async () => {
    await db.asUser(ids.candidateUserA, async (q) => {
      await expectDenied(q("update public.profiles set email = 'x@example.test' where id = auth.uid()"));
      await expectDenied(q("update public.profiles set organization_id = gen_random_uuid() where id = auth.uid()"));
      await q("update public.profiles set full_name = 'Alex Demo' where id = auth.uid()");
    });
    const [profile] = await db.admin("select full_name from public.profiles where id = $1", [ids.candidateUserA]);
    expect(profile.full_name).toBe("Alex Demo");
  });

  it("restricts the audit log to admins", async () => {
    for (const actor of [ids.recruiter, ids.employerA, ids.candidateUserA]) {
      const rows = await db.asUser(actor, (q) => q("select id from public.audit_log"));
      expect(rows).toHaveLength(0);
    }
    const rows = await db.asUser(ids.admin, (q) => q("select id from public.audit_log"));
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("employer company isolation", () => {
  it("shows an employer only their own company", async () => {
    const rows = await db.asUser(ids.employerA, (q) => q("select id from public.companies"));
    expect(rows.map((r) => r.id)).toEqual([ids.companyA]);
  });

  it("shows an employer only their own company's jobs", async () => {
    const rows = await db.asUser(ids.employerA, (q) => q("select id from public.jobs order by title"));
    expect(rows.map((r) => r.id).sort()).toEqual([ids.jobADraft, ids.jobAPublished].sort());
    const other = await db.asUser(ids.employerA, (q) =>
      q("select id from public.jobs where id = $1", [ids.jobBPublished]),
    );
    expect(other).toHaveLength(0);
  });

  it("shows an employer only submissions made to their company", async () => {
    const a = await db.asUser(ids.employerA, (q) => q("select id from public.submissions"));
    expect(a.map((r) => r.id)).toEqual([ids.submissionA]);
    const b = await db.asUser(ids.employerB, (q) => q("select id from public.submissions"));
    expect(b.map((r) => r.id)).toEqual([ids.submissionB]);
  });

  it("never lets an employer read candidate records, notes, or applications", async () => {
    await db.asUser(ids.employerA, async (q) => {
      expect(await q("select id from public.candidates")).toHaveLength(0);
      expect(await q("select id from public.candidate_notes")).toHaveLength(0);
      expect(await q("select id from public.applications")).toHaveLength(0);
      expect(await q("select id from public.profiles where id <> auth.uid()")).toHaveLength(0);
    });
  });

  it("does not let an employer write recruiting data or manage members", async () => {
    await db.asUser(ids.employerA, async (q) => {
      await expectDenied(
        q("update public.jobs set title = 'Changed' where id = $1 returning id", [ids.jobAPublished]).then((rows) => {
          if (rows.length === 0) throw new Error("row-level security: no rows updated");
        }),
      );
      await expectDenied(q("select public.add_company_member($1, $2)", [ids.companyB, ids.employerA]));
      await expectDenied(
        q("insert into public.company_members (company_id, user_id) values ($1, auth.uid())", [ids.companyB]),
      );
    });
  });

  it("revokes company access when the employer role is removed", async () => {
    const userId = await db.createUser("former@company-a.test", { appMeta: { invited: true } });
    await db.asUser(ids.admin, (q) => q("select public.assign_role($1, 'employer')", [userId]));
    await db.asUser(ids.recruiter, (q) => q("select public.add_company_member($1, $2)", [ids.companyA, userId]));
    expect(await db.asUser(userId, (q) => q("select id from public.companies"))).toHaveLength(1);

    await db.asUser(ids.admin, (q) => q("select public.revoke_role($1, 'employer')", [userId]));
    expect(await db.asUser(userId, (q) => q("select id from public.companies"))).toHaveLength(0);
    expect(await db.asUser(userId, (q) => q("select id from public.submissions"))).toHaveLength(0);
  });

  it("only adds users who hold the employer role", async () => {
    await db.asUser(ids.recruiter, async (q) => {
      await expect(q("select public.add_company_member($1, $2)", [ids.companyA, ids.candidateUserA])).rejects.toThrow(
        /employer role/,
      );
    });
  });
});

describe("candidate privacy", () => {
  it("shows a candidate only approved fields of their own record, never the raw row", async () => {
    await db.asUser(ids.candidateUserA, async (q) => {
      expect(await q("select id from public.candidates")).toHaveLength(0);
      const rows = await q("select * from public.my_candidate_profile()");
      expect(rows.map((r) => r.id)).toEqual([ids.candidateA]);
      for (const key of ["tags", "owner_id", "source", "created_by"]) expect(rows[0]).not.toHaveProperty(key);
    });
  });

  it("never shows a candidate internal notes, even about themselves", async () => {
    const rows = await db.asUser(ids.candidateUserA, (q) => q("select id from public.candidate_notes"));
    expect(rows).toHaveLength(0);
  });

  it("shows a candidate only their own submissions", async () => {
    const rows = await db.asUser(ids.candidateUserA, (q) => q("select id from public.submissions"));
    expect(rows.map((r) => r.id)).toEqual([ids.submissionA]);
  });

  it("lets a candidate apply only through apply_to_job and see only the simplified status", async () => {
    await db.asUser(ids.candidateUserA, async (q) => {
      await q("select public.apply_to_job($1)", [ids.jobBPublished]);
      await expect(q("select public.apply_to_job($1)", [ids.jobBPublished])).rejects.toThrow(/already have an active application/);
      expect(await q("select id from public.applications")).toHaveLength(0);
      const mine = await q("select * from public.my_applications()");
      expect(mine.map((r) => r.job_id)).toEqual([ids.jobBPublished]);
      expect(mine[0]).not.toHaveProperty("stage");
    });
    expect(await db.asUser(ids.candidateUserB, (q) => q("select * from public.my_applications()"))).toHaveLength(0);
  });

  it("blocks direct application inserts, for any candidate or job", async () => {
    const [{ org }] = (await db.admin("select organization_id as org from public.candidates where id = $1", [ids.candidateA])) as { org: string }[];
    await db.asUser(ids.candidateUserA, async (q) => {
      for (const [candidate, job] of [
        [ids.candidateA, ids.jobAPublished],
        [ids.candidateB, ids.jobAPublished],
        [ids.candidateA, ids.jobADraft],
      ]) {
        await expectDenied(
          q(
            `insert into public.applications (organization_id, candidate_id, job_id, source, created_by)
             values ($1, $2, $3, 'candidate_portal', auth.uid())`,
            [org, candidate, job],
          ),
        );
      }
      await expect(q("select public.apply_to_job($1)", [ids.jobADraft])).rejects.toThrow(/no longer accepting/);
    });
  });

  it("does not let a candidate read jobs, companies, or other profiles directly", async () => {
    await db.asUser(ids.candidateUserA, async (q) => {
      expect(await q("select id from public.jobs")).toHaveLength(0);
      expect(await q("select id from public.companies")).toHaveLength(0);
      expect(await q("select id from public.profiles")).toEqual([{ id: ids.candidateUserA }]);
    });
  });
});

describe("staff access", () => {
  it("lets recruiters see all recruiting data in their organization", async () => {
    await db.asUser(ids.recruiter, async (q) => {
      expect(await q("select id from public.candidates")).toHaveLength(2);
      expect(await q("select id from public.candidate_notes")).toHaveLength(1);
      expect(await q("select id from public.submissions")).toHaveLength(2);
    });
  });

  it("requires notes to be authored as the signed-in recruiter", async () => {
    await db.asUser(ids.recruiter, async (q) => {
      const org = (await q("select organization_id from public.candidates where id = $1", [ids.candidateA]))[0]
        .organization_id;
      await expectDenied(
        q(
          "insert into public.candidate_notes (organization_id, candidate_id, author_id, body) values ($1, $2, $3, 'spoofed')",
          [org, ids.candidateA, ids.admin],
        ),
      );
    });
  });

  it("gives staff no direct write path to submissions (consent is enforced by the functions)", async () => {
    await db.asUser(ids.recruiter, async (q) => {
      const org = (await q("select organization_id from public.candidates where id = $1", [ids.candidateB]))[0]
        .organization_id;
      await expectDenied(
        q(
          `insert into public.submissions (organization_id, candidate_id, job_id, company_id, candidate_display_name,
             candidate_consent_at, submitted_by)
           values ($1, $2, $3, $4, 'Blair D.', now(), auth.uid())`,
          [org, ids.candidateB, ids.jobBPublished, ids.companyB],
        ),
      );
      await expectDenied(q("update public.submissions set status = 'hired' where id = $1", [ids.submissionA]));
    });
  });

  it("rejects a submission whose company does not own the job", async () => {
    const [{ org }] = (await db.admin("select organization_id as org from public.candidates where id = $1", [ids.candidateB])) as { org: string }[];
    await expect(
      db.admin(
        `insert into public.submissions (organization_id, candidate_id, job_id, company_id, candidate_display_name, candidate_consent_at)
         values ($1, $2, $3, $4, 'Blair D.', now())`,
        [org, ids.candidateB, ids.jobAPublished, ids.companyB],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("public job board", () => {
  it("returns only published jobs with approved public fields to anonymous visitors", async () => {
    const rows = await db.asAnon((q) => q("select * from public.get_published_jobs()"));
    expect(rows.map((r) => r.id).sort()).toEqual([ids.jobAPublished, ids.jobBPublished].sort());
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "employment_type", "id", "location", "public_summary", "published_at", "title", "total_count", "work_arrangement",
      ].sort(),
    );
  });

  it("denies anonymous visitors direct table access", async () => {
    await db.asAnon(async (q) => {
      for (const table of ["jobs", "companies", "candidates", "candidate_notes", "profiles", "user_roles", "submissions"]) {
        await expectDenied(q(`select * from public.${table}`));
      }
      await expectDenied(q("select public.assign_role(gen_random_uuid(), 'admin')"));
    });
  });

  it("caps page size", async () => {
    const rows = await db.asAnon((q) => q("select * from public.get_published_jobs(p_limit => 100000)"));
    expect(rows.length).toBeLessThanOrEqual(100);
  });
});
