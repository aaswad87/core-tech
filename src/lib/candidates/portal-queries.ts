import "server-only";

import type { MyPreferences, MyProfile } from "@/components/candidate-portal/forms";
import { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type MyResume = {
  id: string;
  file_name: string;
  size_bytes: number;
  created_at: string;
  uploaded_by: string | null;
};

export type MyApplication = {
  id: string;
  job_id: string;
  job_title: string;
  job_is_open: boolean;
  status_label: string;
  applied_at: string;
  can_withdraw: boolean;
};

/** Placeholder names the database uses when a record is created before the candidate enters one. */
const PLACEHOLDER_FIRST = "Candidate";
const PLACEHOLDER_LAST = "-";

/**
 * Everything the candidate portal shows, read under RLS as the signed-in candidate. Only approved
 * columns are selected — never tags, owner, source or anything recruiter-maintained.
 */
export async function loadMyPortal(supabase: Supabase, userId: string) {
  const [{ data: profileRow }, { data: candidate }] = await Promise.all([
    supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
    // Approved columns only; candidates have no direct read on the candidates table.
    supabase.rpc("my_candidate_profile").maybeSingle<{
      id: string;
      first_name: string;
      last_name: string;
      phone: string | null;
      location: string | null;
      headline: string | null;
      summary: string | null;
      updated_at: string;
    }>(),
  ]);

  const [resumes, preferences] = candidate
    ? await Promise.all([
        supabase
          .from("candidate_resumes")
          .select("id, file_name, size_bytes, created_at, uploaded_by")
          .eq("candidate_id", candidate.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("candidate_preferences")
          .select(
            "open_to_opportunities, desired_titles, preferred_locations, work_arrangement, willing_to_relocate, email_job_alerts, email_application_updates, phone_contact_ok",
          )
          .eq("candidate_id", candidate.id)
          .maybeSingle(),
      ])
    : [{ data: [] }, { data: null }];

  // Before a candidate record exists, prefill from the sign-up name.
  const fullName = ((profileRow?.full_name as string | null) ?? "").trim();
  const [first, ...rest] = fullName ? fullName.split(/\s+/) : [""];
  const realFirst = candidate && candidate.first_name !== PLACEHOLDER_FIRST ? (candidate.first_name as string) : first;
  const realLast = candidate && candidate.last_name !== PLACEHOLDER_LAST ? (candidate.last_name as string) : rest.join(" ");

  const profile: MyProfile = {
    firstName: realFirst ?? "",
    lastName: realLast ?? "",
    phone: (candidate?.phone as string | null) ?? "",
    location: (candidate?.location as string | null) ?? "",
    headline: (candidate?.headline as string | null) ?? "",
    summary: (candidate?.summary as string | null) ?? "",
  };

  const p = preferences.data;
  const prefs: MyPreferences = {
    openToOpportunities: (p?.open_to_opportunities as boolean | undefined) ?? true,
    desiredTitles: (p?.desired_titles as string | null) ?? "",
    preferredLocations: (p?.preferred_locations as string | null) ?? "",
    workArrangement: (p?.work_arrangement as string | null) ?? "",
    willingToRelocate: (p?.willing_to_relocate as boolean | undefined) ?? false,
    emailJobAlerts: (p?.email_job_alerts as boolean | undefined) ?? false,
    emailApplicationUpdates: (p?.email_application_updates as boolean | undefined) ?? true,
    phoneContactOk: (p?.phone_contact_ok as boolean | undefined) ?? false,
  };

  return {
    email: (profileRow?.email as string | undefined) ?? "",
    hasRecord: Boolean(candidate),
    profile,
    resumes: (resumes.data ?? []) as MyResume[],
    hasPreferences: Boolean(p),
    preferences: prefs,
  };
}

export async function loadMyApplications(supabase: Supabase) {
  const { data, error } = await supabase.rpc("my_applications");
  return { applications: (data ?? []) as MyApplication[], error: Boolean(error) };
}

export type MyInterview = {
  id: string;
  job_title: string;
  company_name: string | null;
  kind: string;
  format: string;
  starts_at: string;
  duration_minutes: number;
  timezone: string;
  meeting_url: string | null;
  location: string | null;
  instructions: string | null;
  status: string;
};

export async function loadMyInterviews(supabase: Supabase) {
  const { data, error } = await supabase.rpc("my_interviews");
  return { interviews: (data ?? []) as MyInterview[], error: Boolean(error) };
}
