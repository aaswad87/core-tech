import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type Query, type TestDb } from "./harness";

let db: TestDb;
let org: string;
let admin: string;
let recruiter: string;
let employer: string;
let alice: string;
let bob: string;
let aliceCandidate: string;
let bobCandidate: string;

const SHA = (n: number) => n.toString(16).padStart(64, "0");

async function myCandidate(q: Query) {
  const [row] = await q("select id from public.my_candidate_profile()");
  return row?.id as string | undefined;
}

async function addResume(q: Query, candidateId: string, n: number) {
  const path = `${org}/${candidateId}/r${n}.pdf`;
  await q("insert into storage.objects (bucket_id, name) values ('resumes', $1)", [path]);
  const [row] = await q(
    `insert into public.candidate_resumes (organization_id, candidate_id, storage_path, file_name, mime_type, size_bytes, sha256, uploaded_by)
     values ($1, $2, $3, 'resume.pdf', 'application/pdf', 100, $4, auth.uid()) returning id`,
    [org, candidateId, path, SHA(n)],
  );
  return { id: row.id as string, path };
}

beforeAll(async () => {
  db = await createTestDb();
  [{ id: org }] = (await db.admin("select id from public.organizations where is_default")) as { id: string }[];
  admin = await db.createUser("admin@coretech.test");
  await db.grantRole(admin, "admin");
  recruiter = await db.createUser("r@coretech.test", { appMeta: { invited: true } });
  employer = await db.createUser("e@company.test", { appMeta: { invited: true } });
  await db.asUser(admin, async (q) => {
    await q("select public.assign_role($1, 'recruiter')", [recruiter]);
    await q("select public.assign_role($1, 'employer')", [employer]);
  });
  alice = await db.createUser("alice@example.test", { userMeta: { full_name: "Alice Demo" } });
  bob = await db.createUser("bob@example.test", { userMeta: { full_name: "Bob Demo" } });
});

describe("profile", () => {
  it("creates the candidate record on first save and updates only approved fields", async () => {
    await db.asUser(alice, async (q) => {
      expect(await myCandidate(q)).toBeUndefined();
      await q("select public.update_my_candidate_profile('Alice', 'Rivera', '+1 214 555 0100', 'Dallas, TX', 'Network engineer', 'CCNP')");
      aliceCandidate = (await myCandidate(q))!;
    });
    const [row] = await db.admin("select first_name, last_name, phone, location, headline, summary, email, source from public.candidates where id = $1", [aliceCandidate]);
    expect(row).toMatchObject({ first_name: "Alice", last_name: "Rivera", location: "Dallas, TX", email: "alice@example.test", source: "Candidate portal" });
    const [profile] = await db.admin("select full_name from public.profiles where id = $1", [alice]);
    expect(profile.full_name).toBe("Alice Rivera");
  });

  it("never lets a candidate update their row directly (tags, owner, source stay recruiter-only)", async () => {
    await db.asUser(alice, async (q) => {
      const rows = await q("update public.candidates set tags = array['hired'], source = 'x' where id = $1 returning id", [aliceCandidate]);
      expect(rows).toHaveLength(0);
    });
    const [row] = await db.admin("select tags, source from public.candidates where id = $1", [aliceCandidate]);
    expect(row).toMatchObject({ tags: [], source: "Candidate portal" });
  });

  it("rejects blank names and invalid values", async () => {
    await db.asUser(alice, async (q) => {
      await expect(q("select public.update_my_candidate_profile(' ', 'Rivera', null, null, null, null)")).rejects.toThrow(/required/);
      await expect(q("select public.update_my_candidate_profile('Alice', 'Rivera', null, null, $1, null)", ["x".repeat(201)])).rejects.toThrow();
    });
  });

  it("is only for candidate accounts", async () => {
    // Invited staff and employer accounts have no candidate role.
    for (const user of [recruiter, employer]) {
      await db.asUser(user, async (q) => {
        await expect(q("select public.update_my_candidate_profile('A', 'B', null, null, null, null)")).rejects.toThrow(/Only candidate accounts/);
      });
    }
    await db.asAnon(async (q) => {
      await expect(q("select public.update_my_candidate_profile('A', 'B', null, null, null, null)")).rejects.toThrow(/permission denied/);
    });
  });

  it("keeps candidates out of each other's records", async () => {
    await db.asUser(bob, async (q) => {
      await q("select public.update_my_candidate_profile('Bob', 'Demo', null, null, null, null)");
      bobCandidate = (await myCandidate(q))!;
      expect(await q("select id from public.candidates")).toHaveLength(0);
      expect((await q("select id from public.my_candidate_profile()")).map((r) => r.id)).toEqual([bobCandidate]);
    });
  });
});

describe("own resumes", () => {
  it("lets a candidate upload, list and remove their own resume", async () => {
    await db.asUser(alice, async (q) => {
      const { id, path } = await addResume(q, aliceCandidate, 1);
      expect(await q("select id from public.candidate_resumes")).toHaveLength(1);
      expect(await q("select name from storage.objects where bucket_id = 'resumes'")).toEqual([{ name: path }]);
      expect(await q("delete from public.candidate_resumes where id = $1 returning id", [id])).toHaveLength(1);
      expect(await q("delete from storage.objects where name = $1 returning id", [path])).toHaveLength(1);
    });
  });

  it("blocks uploads into another candidate's folder", async () => {
    await db.asUser(bob, async (q) => {
      await expect(addResume(q, aliceCandidate, 2)).rejects.toThrow(/row-level security/);
      await expect(
        q("insert into storage.objects (bucket_id, name) values ('resumes', $1)", [`${org}/${aliceCandidate}/sneaky.pdf`]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("hides other candidates' resumes and files", async () => {
    await db.asUser(alice, async (q) => {
      await addResume(q, aliceCandidate, 3);
    });
    await db.asUser(bob, async (q) => {
      expect(await q("select id from public.candidate_resumes")).toHaveLength(0);
      expect(await q("select name from storage.objects where bucket_id = 'resumes'")).toHaveLength(0);
    });
  });

  it("does not let a candidate delete a resume a recruiter added", async () => {
    let path = "";
    await db.asUser(recruiter, async (q) => {
      path = (await addResume(q, aliceCandidate, 4)).path;
    });
    await db.asUser(alice, async (q) => {
      // Visible to the candidate, but not removable by them.
      expect(await q("select id from public.candidate_resumes where storage_path = $1", [path])).toHaveLength(1);
      expect(await q("delete from public.candidate_resumes where storage_path = $1 returning id", [path])).toHaveLength(0);
      expect(await q("delete from storage.objects where name = $1 returning id", [path])).toHaveLength(0);
    });
  });

  it("caps a candidate at five resumes of their own", async () => {
    await db.asUser(alice, async (q) => {
      for (let n = 10; n < 14; n++) await addResume(q, aliceCandidate, n); // 1 existing + 4 = 5
      await expect(addResume(q, aliceCandidate, 14)).rejects.toThrow(/row-level security/);
    });
  });
});

describe("preferences", () => {
  it("lets a candidate set and read their own preferences", async () => {
    await db.asUser(alice, async (q) => {
      await q("select public.set_my_preferences(true, 'Network engineer', 'Dallas', 'hybrid', false, true, true, false)");
      await q("select public.set_my_preferences(false, 'Network engineer', 'Dallas', 'remote', true, false, true, true)");
      const rows = await q("select open_to_opportunities, work_arrangement, willing_to_relocate from public.candidate_preferences");
      expect(rows).toEqual([{ open_to_opportunities: false, work_arrangement: "remote", willing_to_relocate: true }]);
    });
  });

  it("shows preferences to staff only, and never to other candidates or employers", async () => {
    await db.asUser(recruiter, async (q) => {
      expect(await q("select candidate_id from public.candidate_preferences")).toHaveLength(1);
    });
    for (const user of [bob, employer]) {
      await db.asUser(user, async (q) => {
        expect(await q("select candidate_id from public.candidate_preferences")).toHaveLength(0);
      });
    }
  });

  it("has no direct write path", async () => {
    await db.asUser(alice, async (q) => {
      await expect(q("update public.candidate_preferences set phone_contact_ok = false")).rejects.toThrow(/permission denied/);
    });
  });
});

describe("privacy requests", () => {
  let requestId: string;

  it("lets a person file a request and see only their own", async () => {
    await db.asUser(alice, async (q) => {
      [{ id: requestId }] = (await q("select public.submit_privacy_request('access', 'Send me my data') as id")) as { id: string }[];
      await expect(q("select public.submit_privacy_request('access', null)")).rejects.toThrow(/already have a pending/);
      await q("select public.submit_privacy_request('stop_contact', null)");
      expect(await q("select kind from public.privacy_requests")).toHaveLength(2);
    });
    await db.asUser(bob, async (q) => {
      expect(await q("select id from public.privacy_requests")).toHaveLength(0);
    });
  });

  it("is resolved only by administrators", async () => {
    await db.asUser(recruiter, async (q) => {
      expect(await q("select id from public.privacy_requests")).toHaveLength(0);
      await expect(q("select public.resolve_privacy_request($1, 'completed', null)", [requestId])).rejects.toThrow(/not found/);
    });
    await db.asUser(alice, async (q) => {
      await expect(q("select public.resolve_privacy_request($1, 'completed', null)", [requestId])).rejects.toThrow(/not found/);
      await expect(q("update public.privacy_requests set status = 'completed'")).rejects.toThrow(/permission denied/);
    });
    await db.asUser(admin, async (q) => {
      expect(await q("select id from public.privacy_requests")).toHaveLength(2);
      await expect(q("select public.resolve_privacy_request($1, 'declined', '')", [requestId])).rejects.toThrow(/Explain/);
      await q("select public.resolve_privacy_request($1, 'completed', 'Export sent by email')", [requestId]);
    });
    const [row] = await db.admin("select status, resolved_by, resolved_at from public.privacy_requests where id = $1", [requestId]);
    expect(row.status).toBe("completed");
    expect(row.resolved_by).toBe(admin);
    expect(row.resolved_at).not.toBeNull();
  });

  it("allows a new request of the same type once the previous one is closed", async () => {
    await db.asUser(alice, async (q) => {
      await q("select public.submit_privacy_request('access', null)");
    });
  });
});

describe("unchanged staff-only data", () => {
  it("still hides recruiter notes and activity from the candidate", async () => {
    await db.asUser(recruiter, async (q) => {
      await q("insert into public.candidate_notes (organization_id, candidate_id, author_id, body) values ($1, $2, auth.uid(), 'Internal')", [org, aliceCandidate]);
    });
    await db.asUser(alice, async (q) => {
      expect(await q("select id from public.candidate_notes")).toHaveLength(0);
      expect(await q("select id from public.candidate_activity")).toHaveLength(0);
    });
    expect(bobCandidate).toBeDefined();
  });
});
