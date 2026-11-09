import "server-only";

import { createClient } from "@/lib/supabase/server";

export type StaffInterview = {
  id: string;
  application_id: string;
  candidate_id: string;
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
  outcome: string | null;
  outcome_summary: string | null;
  cancel_reason: string | null;
  submission_id: string | null;
  interview_request_id: string | null;
  candidates: { first_name: string; last_name: string; email: string | null } | null;
  jobs: { id: string; title: string } | null;
  companies: { id: string; name: string } | null;
};

const SELECT =
  "id, application_id, candidate_id, kind, format, starts_at, duration_minutes, timezone, meeting_url, location, interviewers, instructions, status, outcome, outcome_summary, cancel_reason, submission_id, interview_request_id, candidates(first_name, last_name, email), jobs(id, title), companies(id, name)";

export async function listInterviews(view: "upcoming" | "past") {
  const supabase = await createClient();
  const now = new Date().toISOString();
  let query = supabase.from("interviews").select(SELECT).limit(200);
  query =
    view === "upcoming"
      ? query.eq("status", "scheduled").gte("starts_at", now).order("starts_at", { ascending: true })
      : query.or(`starts_at.lt.${now},status.neq.scheduled`).order("starts_at", { ascending: false });
  const [{ data }, { count: needsOutcome }, { data: requests }] = await Promise.all([
    query,
    supabase.from("interviews").select("id", { count: "exact", head: true }).eq("status", "scheduled").lt("starts_at", now),
    supabase.from("interview_requests").select("id, company_id, created_at, companies(name), submissions(candidate_display_name)").eq("status", "requested").order("created_at"),
  ]);
  return {
    interviews: (data ?? []) as unknown as StaffInterview[],
    needsOutcome: needsOutcome ?? 0,
    pendingRequests: (requests ?? []) as unknown as {
      id: string;
      company_id: string;
      created_at: string;
      companies: { name: string } | null;
      submissions: { candidate_display_name: string } | null;
    }[],
  };
}

export async function getInterview(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("interviews").select(SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const [events, feedback, deliveries] = await Promise.all([
    supabase.from("interview_events").select("id, action, from_starts_at, to_starts_at, reason, actor_id, created_at").eq("interview_id", id).order("id"),
    supabase.rpc("interview_feedback_with_authors", { p_interview_id: id }),
    supabase
      .from("notification_deliveries")
      .select("id, recipient, subject, status, error, created_at")
      .eq("related_type", "interview")
      .eq("related_id", id)
      .order("created_at", { ascending: false }),
  ]);
  return {
    interview: data as unknown as StaffInterview,
    events: (events.data ?? []) as { id: number; action: string; from_starts_at: string | null; to_starts_at: string | null; reason: string | null; actor_id: string | null; created_at: string }[],
    feedback: (feedback.data ?? []) as { id: string; author_kind: string; rating: number | null; recommendation: string | null; body: string; created_at: string; author_name: string }[],
    deliveries: (deliveries.data ?? []) as { id: number; recipient: string; subject: string | null; status: string; error: string | null; created_at: string }[],
  };
}

type SchedulingRequest = {
  id: string;
  format: string;
  duration_minutes: number;
  timezone: string;
  proposed_times: string[];
  interviewers: string | null;
  notes: string | null;
};

/** The application to schedule for, from ?application= or from an employer interview request. */
export async function getSchedulingContext(params: { applicationId?: string; requestId?: string }) {
  const supabase = await createClient();
  let applicationId = params.applicationId;
  let request: SchedulingRequest | null = null;

  if (params.requestId) {
    const { data: r } = await supabase
      .from("interview_requests")
      .select("id, format, duration_minutes, timezone, proposed_times, interviewers, notes, status, submissions(candidate_id, job_id)")
      .eq("id", params.requestId)
      .maybeSingle();
    if (r && r.status === "requested") {
      const sub = r.submissions as unknown as { candidate_id: string; job_id: string } | null;
      if (sub) {
        const { data: app } = await supabase
          .from("applications")
          .select("id")
          .eq("candidate_id", sub.candidate_id)
          .eq("job_id", sub.job_id)
          .eq("status", "active")
          .maybeSingle();
        applicationId = (app?.id as string | undefined) ?? applicationId;
      }
      request = r as unknown as SchedulingRequest;
    }
  }
  if (!applicationId) return null;

  const { data: app } = await supabase
    .from("applications")
    .select("id, status, stage, candidates(id, first_name, last_name, email), jobs(id, title, companies(name))")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return null;
  return {
    application: app as unknown as {
      id: string;
      status: string;
      stage: string;
      candidates: { id: string; first_name: string; last_name: string; email: string | null } | null;
      jobs: { id: string; title: string; companies: { name: string } | null } | null;
    },
    request,
  };
}
