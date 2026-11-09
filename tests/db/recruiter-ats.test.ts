import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type Query, type TestDb } from "./harness";

let db: TestDb;
let org: string;
let otherOrg: string;
let admin: string;
let recruiterA: string;
let recruiterB: string;
let employer: string;
let candidateUser: string;
let candidate: string;
let company: string;

const SHA = "a".repeat(64);

async function insertCandidate(q: Query, first: string, last: string, extra: Record<string, unknown> = {}) {
  const cols = ["organization_id", "first_name", "last_name", "created_by", ...Object.keys(extra)];
  const values = [org, first, last, ...Object.values(extra)];
  const placeholders = cols.map((c, i) => (c === "created_by" ? "auth.uid()" : `$${i < 3 ? i + 1 : i}`));
  const [row] = await q(
    `insert into public.candidates (${cols.join(", ")}) values (${placeholders.join(", ")}) returning id`,
    values,
  );
  return row.id as string;
}

beforeAll(async () => {
  db = await createTestDb();
  [{ id: org }] = (await db.admin("select id from public.organizations where is_default")) as { id: string }[];
  [{ id: otherOrg }] = (await db.admin(
    "insert into public.organizations (name, slug) values ('Other Agency', 'other') returning id",
  )) as { id: string }[];

  admin = await db.createUser("admin@coretech.test");
  await db.grantRole(admin, "admin");
  recruiterA = await db.createUser("ra@coretech.test", { appMeta: { invited: true } });
  recruiterB = await db.createUser("rb@coretech.test", { appMeta: { invited: true } });
  employer = await db.createUser("employer@company.test", { appMeta: { invited: true } });
  candidateUser = await db.createUser("cand@example.test");
  await db.asUser(admin, async (q) => {
    await q("select public.assign_role($1, 'recruiter')", [recruiterA]);
    await q("select public.assign_role($1, 'recruiter')", [recruiterB]);
    await q("select public.assign_role($1, 'employer')", [employer]);
  });

  await db.asUser(recruiterA, async (q) => {
    [{ id: company }] = (await q(
      "insert into public.companies (organization_id, name, is_demo, created_by) values ($1, 'Demo Co', true, auth.uid()) returning id",
      [org],
    )) as { id: string }[];
    await q("select public.add_company_member($1, $2)", [company, employer]);

    candidate = await insertCandidate(q, "Alex", "Rivera", {
      email: "Alex.Rivera@Example.test",
      phone: "+1 (512) 555-0100",
      user_id: candidateUser,
      owner_id: recruiterA,
      tags: ["ccnp", "open to relocation"],
      headline: "Senior Network Engineer",
    });
    await insertCandidate(q, "Blair", "Chen", { headline: "SOC Analyst", tags: ["security"] });

    await q(
      "insert into public.candidate_skills (organization_id, candidate_id, name, years_experience, created_by) values ($1, $2, 'BGP', 6, auth.uid())",
      [org, candidate],
    );
    await q(
      "insert into public.candidate_certifications (organization_id, candidate_id, name, issuer, created_by) values ($1, $2, 'CCNP Enterprise', 'Cisco', auth.uid())",
      [org, candidate],
    );
    await q(
      `insert into public.candidate_work_history (organization_id, candidate_id, company_name, title, start_date, is_current, created_by)
       values ($1, $2, 'Demo Telecom', 'Network Engineer', '2020-01-01', true, auth.uid())`,
      [org, candidate],
    );
    await q(
      "insert into public.candidate_notes (organization_id, candidate_id, author_id, body) values ($1, $2, auth.uid(), 'Internal: strong BGP, wants remote')",
      [org, candidate],
    );
    await q(
      `insert into public.candidate_resumes (organization_id, candidate_id, storage_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
       values ($1, $2, $3, 'alex.pdf', 'application/pdf', 1000, $4, auth.uid())`,
      [org, candidate, `${org}/${candidate}/r1.pdf`, SHA],
    );
    await q("insert into storage.objects (bucket_id, name) values ('resumes', $1)", [`${org}/${candidate}/r1.pdf`]);
  });
});

const STAFF_ONLY_TABLES = [
  "candidate_skills",
  "candidate_certifications",
  "candidate_work_history",
  "candidate_resumes",
  "candidate_activity",
  "candidate_notes",
];

describe("staff-only candidate data", () => {
  it("is visible to recruiters", async () => {
    await db.asUser(recruiterB, async (q) => {
      for (const table of STAFF_ONLY_TABLES) {
        expect((await q(`select 1 from public.${table}`)).length, table).toBeGreaterThan(0);
      }
    });
  });

  it("is invisible to the candidate the data is about", async () => {
    await db.asUser(candidateUser, async (q) => {
      // The candidate sees approved fields of their own record via my_candidate_profile() (never the raw row
      // with tags/owner/source) and their resumes (candidate-portal.test.ts), but nothing else recruiter-maintained.
      expect(await q("select id from public.candidates")).toHaveLength(0);
      expect((await q("select id from public.my_candidate_profile()")).map((r) => r.id)).toEqual([candidate]);
      for (const table of STAFF_ONLY_TABLES.filter((t) => t !== "candidate_resumes")) {
        expect(await q(`select 1 from public.${table}`), table).toHaveLength(0);
      }
    });
  });

  it("is invisible to employers", async () => {
    await db.asUser(employer, async (q) => {
      for (const table of [...STAFF_ONLY_TABLES, "candidates"]) {
        expect(await q(`select 1 from public.${table}`), table).toHaveLength(0);
      }
    });
  });

  it("cannot be written by candidates or employers", async () => {
    for (const user of [candidateUser, employer]) {
      await db.asUser(user, async (q) => {
        await expect(
          q(
            "insert into public.candidate_skills (organization_id, candidate_id, name, created_by) values ($1, $2, 'Hacking', auth.uid())",
            [org, candidate],
          ),
        ).rejects.toThrow(/row-level security/);
        // Candidates may add resumes to their own record since Phase 8 (candidate-portal.test.ts).
        if (user === candidateUser) return;
        await expect(
          q(
            `insert into public.candidate_resumes (organization_id, candidate_id, storage_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
             values ($1, $2, $3, 'x.pdf', 'application/pdf', 10, $4, auth.uid())`,
            [org, candidate, `${org}/${candidate}/x.pdf`, "b".repeat(64)],
          ),
        ).rejects.toThrow(/row-level security/);
      });
    }
  });

  it("is denied entirely to anonymous visitors", async () => {
    await db.asAnon(async (q) => {
      for (const table of STAFF_ONLY_TABLES) {
        await expect(q(`select 1 from public.${table}`), table).rejects.toThrow(/permission denied/);
      }
    });
  });

  it("does not let anyone edit or delete activity history", async () => {
    await db.asUser(admin, async (q) => {
      await expect(q("update public.candidate_activity set action = 'x'")).rejects.toThrow(/permission denied/);
      await expect(q("delete from public.candidate_activity")).rejects.toThrow(/permission denied/);
      await expect(
        q("insert into public.candidate_activity (organization_id, candidate_id, action) values ($1, $2, 'fake')", [
          org,
          candidate,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("requires rows to be recorded as created by the signed-in recruiter", async () => {
    await db.asUser(recruiterB, async (q) => {
      await expect(
        q(
          "insert into public.candidate_skills (organization_id, candidate_id, name, created_by) values ($1, $2, 'OSPF', $3)",
          [org, candidate, recruiterA],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });
});

describe("activity history", () => {
  it("records profile changes with the acting user and without note contents", async () => {
    const rows = await db.admin(
      "select action, actor_id, details from public.candidate_activity where candidate_id = $1 order by id",
      [candidate],
    );
    expect(rows.map((r) => r.action)).toEqual([
      "candidate.created",
      "skill.added",
      "certification.added",
      "work_history.added",
      "note.added",
      "resume.added",
    ]);
    expect(rows.every((r) => r.actor_id === recruiterA)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("strong BGP");
    expect(rows.find((r) => r.action === "resume.added")?.details).toEqual({ file_name: "alex.pdf" });
  });

  it("lists which fields changed and skips no-op updates", async () => {
    await db.asUser(recruiterA, async (q) => {
      await q("update public.candidates set headline = 'Principal Network Engineer' where id = $1", [candidate]);
      await q("update public.candidates set headline = 'Principal Network Engineer' where id = $1", [candidate]);
    });
    const rows = await db.admin(
      "select details from public.candidate_activity where candidate_id = $1 and action = 'candidate.updated'",
      [candidate],
    );
    expect(rows).toEqual([{ details: { fields: ["headline"] } }]);
  });
});

describe("ownership", () => {
  it("lets only the current owner or an admin reassign a candidate", async () => {
    await db.asUser(recruiterB, async (q) => {
      await expect(q("update public.candidates set owner_id = $2 where id = $1", [candidate, recruiterB])).rejects.toThrow(
        /current owner or an administrator/,
      );
    });
    await db.asUser(recruiterA, (q) => q("update public.candidates set owner_id = $2 where id = $1", [candidate, recruiterB]));
    await db.asUser(admin, (q) => q("update public.candidates set owner_id = $2 where id = $1", [candidate, recruiterA]));

    const [log] = await db.admin(
      "select details from public.candidate_activity where candidate_id = $1 and action = 'candidate.owner_changed' order by id limit 1",
      [candidate],
    );
    expect(log.details).toMatchObject({ from_owner: recruiterA, to_owner: recruiterB });
  });

  it("only allows staff as owners", async () => {
    await db.asUser(recruiterA, async (q) => {
      await expect(q("update public.candidates set owner_id = $2 where id = $1", [candidate, employer])).rejects.toThrow(
        /Owner must be a recruiter/,
      );
      await expect(insertCandidate(q, "Casey", "Lee", { owner_id: candidateUser })).rejects.toThrow(/Owner must be a recruiter/);
    });
  });

  it("protects system-managed columns", async () => {
    await db.asUser(admin, async (q) => {
      await expect(q("update public.candidates set organization_id = $2 where id = $1", [candidate, otherOrg])).rejects.toThrow(
        /cannot be changed/,
      );
      await expect(q("update public.candidates set created_by = $2 where id = $1", [candidate, admin])).rejects.toThrow(
        /cannot be changed/,
      );
    });
  });
});

describe("search", () => {
  it("finds candidates by name, headline, or skill, with a total count", async () => {
    await db.asUser(recruiterB, async (q) => {
      const byName = await q("select id, total_count, skills from public.search_candidates(p_query => 'alex riv')");
      expect(byName.map((r) => r.id)).toEqual([candidate]);
      expect(Number(byName[0].total_count)).toBe(1);
      expect(byName[0].skills).toEqual(["BGP"]);
      expect((await q("select id from public.search_candidates(p_query => 'bgp')")).map((r) => r.id)).toEqual([candidate]);
      expect(await q("select id from public.search_candidates(p_query => 'soc')")).toHaveLength(1);
      expect(await q("select id from public.search_candidates(p_query => '%')")).toHaveLength(0);
    });
  });

  it("filters by owner, tag and skill", async () => {
    await db.asUser(recruiterB, async (q) => {
      expect((await q("select id from public.search_candidates(p_owner_id => $1)", [recruiterA])).map((r) => r.id)).toEqual([
        candidate,
      ]);
      expect(await q("select id from public.search_candidates(p_unowned => true)")).toHaveLength(1);
      expect((await q("select id from public.search_candidates(p_tag => 'CCNP')")).map((r) => r.id)).toEqual([candidate]);
      expect((await q("select id from public.search_candidates(p_skill => 'bgp')")).map((r) => r.id)).toEqual([candidate]);
    });
  });

  it("returns nothing beyond the caller's own record for non-staff", async () => {
    expect(await db.asUser(employer, (q) => q("select id from public.search_candidates()"))).toHaveLength(0);
    // Candidates read their own profile through my_candidate_profile(), never through staff search.
    expect(await db.asUser(candidateUser, (q) => q("select id from public.search_candidates()"))).toHaveLength(0);
    await db.asAnon(async (q) => {
      await expect(q("select * from public.search_candidates()")).rejects.toThrow(/permission denied/);
    });
  });
});

describe("duplicate detection", () => {
  it("matches on normalized email, phone digits, or full name", async () => {
    await db.asUser(recruiterB, async (q) => {
      const [byEmail] = await q("select id, match_reasons from public.find_candidate_duplicates(' ALEX.rivera@example.TEST ', null, null, null)");
      expect(byEmail).toEqual({ id: candidate, match_reasons: ["email"] });

      const [byPhone] = await q("select match_reasons from public.find_candidate_duplicates(null, '512.555.0100', null, null)");
      expect(byPhone.match_reasons).toEqual(["phone"]);

      const [all] = await q(
        "select match_reasons from public.find_candidate_duplicates('alex.rivera@example.test', '5125550100', 'alex', 'RIVERA')",
      );
      expect(all.match_reasons).toEqual(["email", "phone", "name"]);

      expect(await q("select 1 from public.find_candidate_duplicates('new@example.test', '999', 'New', 'Person')")).toHaveLength(0);
    });
  });

  it("excludes the candidate being edited", async () => {
    const rows = await db.asUser(recruiterB, (q) =>
      q("select id from public.find_candidate_duplicates('alex.rivera@example.test', null, null, null, $1)", [candidate]),
    );
    expect(rows).toHaveLength(0);
  });

  it("reveals nothing to employers", async () => {
    const rows = await db.asUser(employer, (q) =>
      q("select id from public.find_candidate_duplicates('alex.rivera@example.test', null, 'Alex', 'Rivera')"),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("tags", () => {
  it("rejects malformed or excessive tags", async () => {
    await db.asUser(recruiterA, async (q) => {
      await expect(q("update public.candidates set tags = array['Has Caps'] where id = $1", [candidate])).rejects.toThrow(/check/);
      await expect(
        q("update public.candidates set tags = (select array_agg('t' || g) from generate_series(1, 21) g) where id = $1", [candidate]),
      ).rejects.toThrow(/check/);
    });
  });
});

describe("resume storage", () => {
  const path = (o: string, c: string, f = "r2.pdf") => `${o}/${c}/${f}`;

  it("lets staff upload and read files under their organization's prefix", async () => {
    await db.asUser(recruiterB, async (q) => {
      await q("insert into storage.objects (bucket_id, name) values ('resumes', $1)", [path(org, candidate)]);
      expect((await q("select name from storage.objects where bucket_id = 'resumes'")).length).toBe(2);
    });
  });

  it("blocks staff from writing outside their organization or into malformed paths", async () => {
    await db.asUser(recruiterB, async (q) => {
      await expect(
        q("insert into storage.objects (bucket_id, name) values ('resumes', $1)", [path(otherOrg, candidate)]),
      ).rejects.toThrow(/row-level security/);
      await expect(q("insert into storage.objects (bucket_id, name) values ('resumes', 'loose-file.pdf')")).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  it("does not let staff overwrite an existing resume", async () => {
    await db.asUser(recruiterB, async (q) => {
      const rows = await q("update storage.objects set metadata = '{}'::jsonb where bucket_id = 'resumes' returning id");
      expect(rows).toHaveLength(0);
    });
  });

  it("hides resume files from employers and anonymous users", async () => {
    // Candidates see only their own folder since Phase 8 (candidate-portal.test.ts).
    for (const user of [employer]) {
      await db.asUser(user, async (q) => {
        expect(await q("select name from storage.objects where bucket_id = 'resumes'")).toHaveLength(0);
        await expect(
          q("insert into storage.objects (bucket_id, name) values ('resumes', $1)", [path(org, candidate, "x.pdf")]),
        ).rejects.toThrow(/row-level security/);
      });
    }
    expect(await db.asAnon((q) => q("select name from storage.objects where bucket_id = 'resumes'"))).toHaveLength(0);
  });

  it("is a private bucket limited to 4 MB PDF and DOCX files", async () => {
    const [bucket] = await db.admin("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'resumes'");
    expect(bucket.public).toBe(false);
    expect(Number(bucket.file_size_limit)).toBe(4 * 1024 * 1024);
    expect(bucket.allowed_mime_types).toEqual([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
  });

  it("requires resume metadata paths to match the candidate", async () => {
    await db.asUser(recruiterA, async (q) => {
      await expect(
        q(
          `insert into public.candidate_resumes (organization_id, candidate_id, storage_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
           values ($1, $2, 'elsewhere/r.pdf', 'r.pdf', 'application/pdf', 10, $3, auth.uid())`,
          [org, candidate, "c".repeat(64)],
        ),
      ).rejects.toThrow(/check/);
      await expect(
        q(
          `insert into public.candidate_resumes (organization_id, candidate_id, storage_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
           values ($1, $2, $3, 'big.pdf', 'application/pdf', 5000000, $4, auth.uid())`,
          [org, candidate, `${org}/${candidate}/big.pdf`, "d".repeat(64)],
        ),
      ).rejects.toThrow(/check/);
    });
  });
});

describe("candidate deletion", () => {
  it("is admin-only, cascades profile data, and is recorded in the audit log", async () => {
    const id = await db.asUser(recruiterA, (q) => insertCandidate(q, "Temp", "Person"));
    await db.asUser(recruiterA, (q) =>
      q("insert into public.candidate_skills (organization_id, candidate_id, name, created_by) values ($1, $2, 'Linux', auth.uid())", [
        org,
        id,
      ]),
    );

    const recruiterDelete = await db.asUser(recruiterA, (q) => q("delete from public.candidates where id = $1 returning id", [id]));
    expect(recruiterDelete).toHaveLength(0);

    await db.asUser(admin, (q) => q("delete from public.candidates where id = $1", [id]));
    expect(await db.admin("select 1 from public.candidate_skills where candidate_id = $1", [id])).toHaveLength(0);
    expect(await db.admin("select 1 from public.candidate_activity where candidate_id = $1", [id])).toHaveLength(0);
    expect(await db.admin("select actor_id from public.audit_log where action = 'candidate.deleted' and entity_id = $1", [id])).toEqual([
      { actor_id: admin },
    ]);
  });
});
