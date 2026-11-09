import "server-only";

import { cache } from "react";

import type {
  ActivityRow,
  CandidateRow,
  CertificationRow,
  DuplicateMatch,
  NoteRow,
  ResumeRow,
  SkillRow,
  StaffMember,
  WorkHistoryRow,
} from "@/lib/candidates/types";
import { createClient } from "@/lib/supabase/server";

/**
 * All queries run as the signed-in user, so RLS decides what is returned. Callers must still
 * check the staff role first (requireRole) to render the right page.
 */

/** Admins and recruiters in the caller's organization, for owner pickers and display names. */
export const getStaffMembers = cache(async (): Promise<StaffMember[]> => {
  const supabase = await createClient();
  const { data: roles } = await supabase.from("user_roles").select("user_id").in("role", ["admin", "recruiter"]);
  const ids = [...new Set((roles ?? []).map((r) => r.user_id as string))];
  if (!ids.length) return [];
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
  return (profiles ?? [])
    .map((p) => ({ id: p.id as string, name: (p.full_name as string | null) ?? (p.email as string) }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

/** Display names for any profiles staff can see (owners, note authors, activity actors). */
export async function getProfileNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (!unique.length) return names;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", unique);
  for (const p of data ?? []) names.set(p.id as string, (p.full_name as string | null) ?? (p.email as string));
  return names;
}

export type CandidateDetail = {
  candidate: CandidateRow;
  skills: SkillRow[];
  certifications: CertificationRow[];
  workHistory: WorkHistoryRow[];
  resumes: ResumeRow[];
  notes: NoteRow[];
  activity: ActivityRow[];
  duplicates: DuplicateMatch[];
};

export const ACTIVITY_LIMIT = 50;

export async function getCandidateDetail(id: string): Promise<CandidateDetail | null> {
  const supabase = await createClient();
  const { data: candidate, error } = await supabase.from("candidates").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load candidate: ${error.message}`);
  if (!candidate) return null;

  const [skills, certifications, workHistory, resumes, notes, activity, duplicates] = await Promise.all([
    supabase.from("candidate_skills").select("id, name, years_experience").eq("candidate_id", id).order("name"),
    supabase
      .from("candidate_certifications")
      .select("id, name, issuer, credential_id, issued_on, expires_on")
      .eq("candidate_id", id)
      .order("issued_on", { ascending: false, nullsFirst: false }),
    supabase
      .from("candidate_work_history")
      .select("id, company_name, title, location, start_date, end_date, is_current, description")
      .eq("candidate_id", id)
      .order("is_current", { ascending: false })
      .order("start_date", { ascending: false, nullsFirst: false }),
    supabase
      .from("candidate_resumes")
      .select("id, file_name, mime_type, size_bytes, uploaded_by, created_at")
      .eq("candidate_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("candidate_notes")
      .select("id, body, author_id, created_at")
      .eq("candidate_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("candidate_activity")
      .select("id, actor_id, action, details, created_at")
      .eq("candidate_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(ACTIVITY_LIMIT),
    supabase.rpc("find_candidate_duplicates", {
      p_email: candidate.email,
      p_phone: candidate.phone,
      p_first_name: candidate.first_name,
      p_last_name: candidate.last_name,
      p_exclude_id: id,
    }),
  ]);

  const failed = [skills, certifications, workHistory, resumes, notes, activity, duplicates].find((r) => r.error);
  if (failed?.error) throw new Error(`Failed to load candidate details: ${failed.error.message}`);

  return {
    candidate: candidate as CandidateRow,
    skills: (skills.data ?? []) as SkillRow[],
    certifications: (certifications.data ?? []) as CertificationRow[],
    workHistory: (workHistory.data ?? []) as WorkHistoryRow[],
    resumes: (resumes.data ?? []) as ResumeRow[],
    notes: (notes.data ?? []) as NoteRow[],
    activity: (activity.data ?? []) as ActivityRow[],
    duplicates: (duplicates.data ?? []) as DuplicateMatch[],
  };
}

export type CandidatePreferences = {
  open_to_opportunities: boolean;
  desired_titles: string | null;
  preferred_locations: string | null;
  work_arrangement: string | null;
  willing_to_relocate: boolean;
  email_job_alerts: boolean;
  email_application_updates: boolean;
  phone_contact_ok: boolean;
};

/** Preferences the candidate set in their portal, or null if they haven't. Staff read access via RLS. */
export async function getCandidatePreferences(id: string): Promise<CandidatePreferences | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("candidate_preferences")
    .select(
      "open_to_opportunities, desired_titles, preferred_locations, work_arrangement, willing_to_relocate, email_job_alerts, email_application_updates, phone_contact_ok",
    )
    .eq("candidate_id", id)
    .maybeSingle();
  return (data as CandidatePreferences | null) ?? null;
}
