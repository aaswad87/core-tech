import "server-only";

import { createClient } from "@/lib/supabase/server";

/** Staff reads for jobs and the pipeline. All run under RLS as the signed-in user. */

export type StaffJob = {
  id: string;
  title: string;
  status: string;
  location: string | null;
  work_arrangement: string | null;
  employment_type: string;
  salary_min: number | null;
  salary_max: number | null;
  required_skills: string[];
  preferred_skills: string[];
  public_summary: string | null;
  public_description: string | null;
  description: string | null;
  owner_id: string | null;
  company_id: string;
  published_at: string | null;
  updated_at: string;
  is_demo: boolean;
  companies: { name: string } | null;
};

const JOB_SELECT =
  "id, title, status, location, work_arrangement, employment_type, salary_min, salary_max, required_skills, preferred_skills, public_summary, public_description, description, owner_id, company_id, published_at, updated_at, is_demo, companies(name)";

export const JOBS_PAGE_SIZE = 25;

export async function listStaffJobs(filter: { status: string; query: string; page: number }) {
  const supabase = await createClient();
  let q = supabase
    .from("jobs")
    .select(JOB_SELECT, { count: "exact" })
    .order("updated_at", { ascending: false })
    .range((filter.page - 1) * JOBS_PAGE_SIZE, filter.page * JOBS_PAGE_SIZE - 1);
  if (filter.status === "open") q = q.in("status", ["draft", "pending", "published", "paused"]);
  else if (filter.status !== "all") q = q.eq("status", filter.status);
  if (filter.query) q = q.ilike("title", `%${filter.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const { data, error, count } = await q;
  if (error) throw new Error(`Failed to load jobs: ${error.message}`);
  const jobs = (data ?? []) as unknown as StaffJob[];

  // Active application counts per job.
  const counts = new Map<string, number>();
  if (jobs.length) {
    const { data: apps } = await supabase.from("applications").select("job_id").eq("status", "active").in("job_id", jobs.map((j) => j.id));
    for (const a of apps ?? []) counts.set(a.job_id as string, (counts.get(a.job_id as string) ?? 0) + 1);
  }
  return { jobs, total: count ?? 0, counts };
}

export async function getStaffJob(id: string): Promise<StaffJob | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("jobs").select(JOB_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load job: ${error.message}`);
  return data as unknown as StaffJob | null;
}

export async function listCompanies(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("id, name").order("name").limit(500);
  return (data ?? []) as { id: string; name: string }[];
}

export async function listOpenJobsForPicker(): Promise<{ id: string; title: string; company: string | null; status: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, title, status, companies(name)")
    .in("status", ["draft", "pending", "published", "paused"])
    .order("updated_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as unknown as { id: string; title: string; status: string; companies: { name: string } | null }[]).map((j) => ({
    id: j.id,
    title: j.title,
    status: j.status,
    company: j.companies?.name ?? null,
  }));
}

export type PipelineCard = {
  id: string;
  stage: string;
  status: string;
  stageChangedAt: string;
  createdAt: string;
  source: string;
  candidate: { id: string; firstName: string; lastName: string; headline: string | null; location: string | null; ownerId: string | null };
  job: { id: string; title: string; companyName: string | null };
  history: { fromStage: string | null; toStage: string; reason: string | null; actorId: string | null; createdAt: string }[];
};

type AppRow = {
  id: string;
  stage: string;
  status: string;
  stage_changed_at: string;
  created_at: string;
  source: string;
  candidates: { id: string; first_name: string; last_name: string; headline: string | null; location: string | null; owner_id: string | null } | null;
  jobs: { id: string; title: string; companies: { name: string } | null } | null;
};

export const PIPELINE_LIMIT = 500;

/** Applications for the board/table, newest activity first, with recent stage history. */
export async function listPipeline(filter: { jobId?: string | null; stage?: string | null; ownerId?: string | null; includeClosed?: boolean }) {
  const supabase = await createClient();
  let q = supabase
    .from("applications")
    .select(
      "id, stage, status, stage_changed_at, created_at, source, candidates!inner(id, first_name, last_name, headline, location, owner_id), jobs!inner(id, title, companies(name))",
    )
    .order("stage_changed_at", { ascending: false })
    .limit(PIPELINE_LIMIT);
  if (filter.jobId) q = q.eq("job_id", filter.jobId);
  if (filter.stage) q = q.eq("stage", filter.stage);
  if (filter.ownerId) q = q.eq("candidates.owner_id", filter.ownerId);
  if (!filter.includeClosed && !filter.stage) q = q.eq("status", "active");
  const { data, error } = await q;
  if (error) throw new Error(`Failed to load pipeline: ${error.message}`);
  const rows = (data ?? []) as unknown as AppRow[];

  const ids = rows.map((r) => r.id);
  const history = new Map<string, PipelineCard["history"]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: events } = await supabase
      .from("application_stage_events")
      .select("application_id, from_stage, to_stage, reason, actor_id, created_at")
      .in("application_id", ids.slice(i, i + 200))
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    for (const e of (events ?? []) as { application_id: string; from_stage: string | null; to_stage: string; reason: string | null; actor_id: string | null; created_at: string }[]) {
      const list = history.get(e.application_id) ?? [];
      if (list.length < 15) list.push({ fromStage: e.from_stage, toStage: e.to_stage, reason: e.reason, actorId: e.actor_id, createdAt: e.created_at });
      history.set(e.application_id, list);
    }
  }

  return rows
    .filter((r) => r.candidates && r.jobs)
    .map(
      (r): PipelineCard => ({
        id: r.id,
        stage: r.stage,
        status: r.status,
        stageChangedAt: r.stage_changed_at,
        createdAt: r.created_at,
        source: r.source,
        candidate: {
          id: r.candidates!.id,
          firstName: r.candidates!.first_name,
          lastName: r.candidates!.last_name,
          headline: r.candidates!.headline,
          location: r.candidates!.location,
          ownerId: r.candidates!.owner_id,
        },
        job: { id: r.jobs!.id, title: r.jobs!.title, companyName: r.jobs!.companies?.name ?? null },
        history: history.get(r.id) ?? [],
      }),
    );
}

/** A candidate's applications with stage, for the candidate profile page. */
export async function listCandidateApplications(candidateId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("applications")
    .select("id, stage, status, stage_changed_at, created_at, jobs(id, title, status, companies(name))")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as {
    id: string;
    stage: string;
    status: string;
    stage_changed_at: string;
    created_at: string;
    jobs: { id: string; title: string; status: string; companies: { name: string } | null } | null;
  }[];
}
