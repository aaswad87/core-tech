import "server-only";

import type { InterviewRequestRow, JobRequestRow, MemberRequestRow, TeamMember } from "@/lib/employer/queries";
import { createClient } from "@/lib/supabase/server";

export type StaffCompanyRow = {
  id: string;
  name: string;
  industry: string | null;
  is_demo: boolean;
  pendingJobRequests: number;
  pendingInterviews: number;
  pendingMembers: number;
};

/** All companies with counts of employer requests waiting on staff. */
export async function listCompaniesForStaff(): Promise<StaffCompanyRow[]> {
  const supabase = await createClient();
  const [companies, jobRequests, interviews, members] = await Promise.all([
    supabase.from("companies").select("id, name, industry, is_demo").order("name").limit(500),
    supabase.from("job_requests").select("company_id").in("status", ["submitted", "in_review"]),
    supabase.from("interview_requests").select("company_id").eq("status", "requested"),
    supabase.from("company_member_requests").select("company_id").eq("status", "pending"),
  ]);
  const count = (rows: { company_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.company_id === id).length;
  return ((companies.data ?? []) as Omit<StaffCompanyRow, "pendingJobRequests" | "pendingInterviews" | "pendingMembers">[]).map((c) => ({
    ...c,
    pendingJobRequests: count(jobRequests.data as { company_id: string }[] | null, c.id),
    pendingInterviews: count(interviews.data as { company_id: string }[] | null, c.id),
    pendingMembers: count(members.data as { company_id: string }[] | null, c.id),
  }));
}

export type StaffSubmission = {
  id: string;
  status: string;
  candidate_id: string;
  candidate_display_name: string;
  shared_resume_id: string | null;
  employer_responded_at: string | null;
  created_at: string;
  jobs: { title: string } | null;
};

export type StaffResume = { id: string; candidate_id: string; file_name: string; created_at: string };

export type StaffFeedback = { id: string; submission_id: string; rating: number | null; body: string; created_at: string };

export async function getCompanyForStaff(companyId: string) {
  const supabase = await createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, name, website, industry, headquarters, about, is_demo")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return null;

  const [team, memberRequests, jobRequests, submissions, interviews, feedback] = await Promise.all([
    supabase.rpc("company_team", { p_company_id: companyId }),
    supabase
      .from("company_member_requests")
      .select("id, full_name, email, member_role, status, created_at")
      .eq("company_id", companyId)
      .eq("status", "pending")
      .order("created_at"),
    supabase
      .from("job_requests")
      .select("id, title, location, work_arrangement, employment_type, openings, salary_min, salary_max, target_start, description, must_have_skills, status, response_note, job_id, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("submissions")
      .select("id, status, candidate_id, candidate_display_name, shared_resume_id, employer_responded_at, created_at, jobs(title)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("interview_requests")
      .select("id, submission_id, format, duration_minutes, timezone, proposed_times, interviewers, notes, status, confirmed_time, response_note, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("submission_feedback").select("id, submission_id, rating, body, created_at").eq("company_id", companyId).order("created_at"),
  ]);

  const subs = (submissions.data ?? []) as unknown as StaffSubmission[];
  const candidateIds = [...new Set(subs.map((s) => s.candidate_id))];
  const { data: resumes } = candidateIds.length
    ? await supabase
        .from("candidate_resumes")
        .select("id, candidate_id, file_name, created_at")
        .in("candidate_id", candidateIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  return {
    company: company as {
      id: string;
      name: string;
      website: string | null;
      industry: string | null;
      headquarters: string | null;
      about: string | null;
      is_demo: boolean;
    },
    team: (team.data ?? []) as TeamMember[],
    memberRequests: (memberRequests.data ?? []) as MemberRequestRow[],
    jobRequests: (jobRequests.data ?? []) as JobRequestRow[],
    submissions: subs,
    interviews: (interviews.data ?? []) as (InterviewRequestRow & { submission_id: string })[],
    feedback: (feedback.data ?? []) as StaffFeedback[],
    resumes: (resumes ?? []) as StaffResume[],
  };
}
