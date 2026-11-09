import { z } from "zod";

import { createPublicClient } from "@/lib/supabase/public";

export const WORK_ARRANGEMENTS = [
  { value: "onsite", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
] as const;

export const EMPLOYMENT_TYPE_LABELS = {
  direct_hire: "Direct hire",
  contract: "Contract",
  contract_to_hire: "Contract-to-hire",
} as const;

export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number]["value"];

export function workArrangementLabel(value: string | null): string | null {
  return WORK_ARRANGEMENTS.find((w) => w.value === value)?.label ?? null;
}

const workArrangementSchema = z.enum(["onsite", "hybrid", "remote"]).nullable();
const employmentTypeSchema = z.enum(["direct_hire", "contract", "contract_to_hire"]);

const jobSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  public_summary: z.string().nullable(),
  location: z.string().nullable(),
  work_arrangement: workArrangementSchema,
  employment_type: employmentTypeSchema,
  published_at: z.string(),
});

const jobListRowSchema = jobSummarySchema.extend({ total_count: z.coerce.number() });
const jobDetailSchema = jobSummarySchema.extend({
  public_description: z.string().nullable(),
  required_skills: z.array(z.string()).default([]),
  preferred_skills: z.array(z.string()).default([]),
});

export type PublicJobSummary = z.infer<typeof jobSummarySchema>;
export type PublicJobDetail = z.infer<typeof jobDetailSchema>;

export const JOBS_PAGE_SIZE = 10;
const MAX_PAGE = 1000;

export type JobSearch = { query: string; arrangement: WorkArrangement | null; page: number };

/** Normalizes untrusted search params into a safe search. */
export function parseJobSearch(params: Record<string, string | string[] | undefined>): JobSearch {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const query = (first(params.q) ?? "").trim().slice(0, 100);
  const arrangementRaw = first(params.arrangement);
  const arrangement = WORK_ARRANGEMENTS.some((w) => w.value === arrangementRaw)
    ? (arrangementRaw as WorkArrangement)
    : null;
  const pageNumber = Number.parseInt(first(params.page) ?? "1", 10);
  const page = Number.isFinite(pageNumber) ? Math.min(Math.max(pageNumber, 1), MAX_PAGE) : 1;
  return { query, arrangement, page };
}

export type JobListResult =
  | { status: "unconfigured" }
  | { status: "error" }
  | { status: "ok"; jobs: PublicJobSummary[]; total: number; page: number; pageCount: number };

export async function listPublishedJobs(search: JobSearch): Promise<JobListResult> {
  const supabase = createPublicClient();
  if (!supabase) return { status: "unconfigured" };

  const { data, error } = await supabase.rpc("get_published_jobs", {
    p_query: search.query || null,
    p_work_arrangement: search.arrangement,
    p_limit: JOBS_PAGE_SIZE,
    p_offset: (search.page - 1) * JOBS_PAGE_SIZE,
  });
  if (error) {
    console.error("Failed to load published jobs", error.message);
    return { status: "error" };
  }

  const rows = z.array(jobListRowSchema).safeParse(data);
  if (!rows.success) {
    console.error("Unexpected job board response shape");
    return { status: "error" };
  }

  const total = rows.data[0]?.total_count ?? 0;
  return {
    status: "ok",
    jobs: rows.data.map((row) => jobSummarySchema.parse(row)),
    total,
    page: search.page,
    pageCount: Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE)),
  };
}

export type JobDetailResult =
  | { status: "unconfigured" }
  | { status: "error" }
  | { status: "not_found" }
  | { status: "ok"; job: PublicJobDetail };

export async function getPublishedJob(id: string): Promise<JobDetailResult> {
  if (!z.uuid().safeParse(id).success) return { status: "not_found" };

  const supabase = createPublicClient();
  if (!supabase) return { status: "unconfigured" };

  const { data, error } = await supabase.rpc("get_published_job", { p_job_id: id });
  if (error) {
    console.error("Failed to load job", error.message);
    return { status: "error" };
  }

  const rows = z.array(jobDetailSchema).safeParse(data);
  if (!rows.success) return { status: "error" };
  const job = rows.data[0];
  return job ? { status: "ok", job } : { status: "not_found" };
}

/** Builds a /jobs URL that preserves the current filters. */
export function jobsHref(search: JobSearch, overrides: Partial<JobSearch> = {}): string {
  const next = { ...search, ...overrides };
  const params = new URLSearchParams();
  if (next.query) params.set("q", next.query);
  if (next.arrangement) params.set("arrangement", next.arrangement);
  if (next.page > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return qs ? `/jobs?${qs}` : "/jobs";
}
