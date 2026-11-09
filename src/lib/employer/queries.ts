import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type MyCompany = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  headquarters: string | null;
  about: string | null;
  is_demo: boolean;
  myRole: "owner" | "member";
};

/** Companies the signed-in employer belongs to (RLS returns only their own). */
export const listMyCompanies = cache(async (userId: string): Promise<MyCompany[]> => {
  const supabase = await createClient();
  const [{ data: companies }, { data: memberships }] = await Promise.all([
    supabase.from("companies").select("id, name, website, industry, headquarters, about, is_demo").order("name"),
    supabase.from("company_members").select("company_id, member_role").eq("user_id", userId),
  ]);
  const roles = new Map((memberships ?? []).map((m) => [m.company_id as string, m.member_role as MyCompany["myRole"]]));
  return ((companies ?? []) as Omit<MyCompany, "myRole">[])
    .filter((c) => roles.has(c.id))
    .map((c) => ({ ...c, myRole: roles.get(c.id)! }));
});

/** The company if the employer is a member of it, else null (callers then 404). */
export async function getMyCompany(userId: string, companyId: string): Promise<MyCompany | null> {
  return (await listMyCompanies(userId)).find((c) => c.id === companyId) ?? null;
}

export type EmployerJob = {
  id: string;
  title: string;
  status: string;
  location: string | null;
  work_arrangement: string | null;
  employment_type: string;
  published_at: string | null;
};

export type EmployerSubmission = {
  id: string;
  job_id: string;
  status: string;
  candidate_display_name: string;
  shared_summary: string | null;
  shared_resume_id: string | null;
  created_at: string;
};

/** Jobs and submissions for one company. Selects only employer-appropriate columns. */
export async function getCompanyOverview(companyId: string) {
  const supabase = await createClient();
  const [jobs, submissions, pendingRequests] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, status, location, work_arrangement, employment_type, published_at")
      .eq("company_id", companyId)
      .not("status", "in", "(archived)")
      .order("created_at", { ascending: false }),
    supabase
      .from("submissions")
      .select("id, job_id, status, candidate_display_name, shared_summary, shared_resume_id, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabase.from("job_requests").select("id", { count: "exact", head: true }).eq("company_id", companyId).in("status", ["submitted", "in_review"]),
  ]);
  return {
    jobs: (jobs.data ?? []) as EmployerJob[],
    submissions: (submissions.data ?? []) as EmployerSubmission[],
    pendingRequestCount: pendingRequests.count ?? 0,
    error: Boolean(jobs.error || submissions.error),
  };
}

export type JobRequestRow = {
  id: string;
  title: string;
  location: string | null;
  work_arrangement: string | null;
  employment_type: string;
  openings: number;
  salary_min: number | null;
  salary_max: number | null;
  target_start: string | null;
  description: string;
  must_have_skills: string | null;
  status: string;
  response_note: string | null;
  job_id: string | null;
  created_at: string;
};

export async function listJobRequests(companyId: string): Promise<JobRequestRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_requests")
    .select("id, title, location, work_arrangement, employment_type, openings, salary_min, salary_max, target_start, description, must_have_skills, status, response_note, job_id, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  return (data ?? []) as JobRequestRow[];
}

export type InterviewRequestRow = {
  id: string;
  format: string;
  duration_minutes: number;
  timezone: string;
  proposed_times: string[];
  interviewers: string | null;
  notes: string | null;
  status: string;
  confirmed_time: string | null;
  response_note: string | null;
  created_at: string;
};

export type CompanyInterview = {
  id: string;
  submission_id: string;
  candidate_display_name: string;
  job_title: string;
  kind: string;
  format: string;
  starts_at: string;
  duration_minutes: number;
  timezone: string;
  meeting_url: string | null;
  location: string | null;
  interviewers: string | null;
  instructions: string | null;
  status: string;
};

/** Client interviews for the company, via company_interviews() (approved columns only). */
export async function listCompanyInterviews(companyId: string): Promise<CompanyInterview[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("company_interviews", { p_company_id: companyId });
  return (data ?? []) as CompanyInterview[];
}

export type FeedbackRow ={ id: string; rating: number | null; body: string; created_at: string; author_name: string };

export async function getSubmissionDetail(companyId: string, submissionId: string) {
  const supabase = await createClient();
  const { data: submission } = await supabase
    .from("submissions")
    .select("id, job_id, status, candidate_display_name, shared_summary, shared_resume_id, created_at, jobs(title)")
    .eq("id", submissionId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!submission) return null;

  const [interviews, feedback, scheduled] = await Promise.all([
    supabase
      .from("interview_requests")
      .select("id, format, duration_minutes, timezone, proposed_times, interviewers, notes, status, confirmed_time, response_note, created_at")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false }),
    supabase.rpc("submission_feedback_with_authors", { p_submission_id: submissionId }),
    supabase.rpc("company_interviews", { p_company_id: companyId }),
  ]);

  const job = submission.jobs as unknown as { title: string } | null;
  return {
    submission: submission as unknown as EmployerSubmission,
    jobTitle: job?.title ?? "Job",
    interviews: (interviews.data ?? []) as InterviewRequestRow[],
    feedback: (feedback.data ?? []) as FeedbackRow[],
    scheduled: ((scheduled.data ?? []) as CompanyInterview[]).filter((i) => i.submission_id === submissionId),
  };
}

export type TeamMember = { user_id: string; full_name: string | null; email: string; member_role: "owner" | "member"; joined_at: string };
export type MemberRequestRow = { id: string; full_name: string; email: string; member_role: string; status: string; created_at: string };

export async function getCompanyTeam(companyId: string, includeRequests: boolean) {
  const supabase = await createClient();
  const [team, requests] = await Promise.all([
    supabase.rpc("company_team", { p_company_id: companyId }),
    includeRequests
      ? supabase
          .from("company_member_requests")
          .select("id, full_name, email, member_role, status, created_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
  ]);
  return { team: (team.data ?? []) as TeamMember[], requests: (requests.data ?? []) as MemberRequestRow[] };
}
