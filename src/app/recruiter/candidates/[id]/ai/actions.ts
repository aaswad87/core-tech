"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { checkProposal, type ReviewedProposal } from "@/lib/ai/proposal";
import { proposeWithOpenAI } from "@/lib/ai/openai";
import { normalizeResumeText, redactContactDetails } from "@/lib/ai/redact";
import { loadResumeText } from "@/lib/ai/resume-source";
import { getStaffUser } from "@/lib/auth/session";
import { idSchema } from "@/lib/candidates/validation";
import { getAiConfig } from "@/lib/env.server";
import { type FormState, formString } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

function dbMessage(error: { code?: string; message: string }, fallback: string): string {
  if (["22023", "23505", "42501", "P0002"].includes(error.code ?? "")) return error.message;
  console.error("AI parse action failed", error.code, error.message);
  return fallback;
}

/**
 * Sends one resume (contact details removed) to the AI provider and stores the *proposal*. Nothing is
 * written to the candidate record here; the recruiter reviews the suggestions on the next page.
 */
export async function parseResumeWithAi(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getStaffUser();
  if (!user) return { status: "error", message: "Only recruiters and administrators can use AI parsing." };
  const candidateId = idSchema.safeParse(formString(formData, "candidateId"));
  const resumeId = idSchema.safeParse(formString(formData, "resumeId"));
  if (!candidateId.success || !resumeId.success) return { status: "error", message: "Unknown resume." };

  let config;
  try {
    config = getAiConfig();
  } catch (e) {
    console.error("AI configuration invalid", e instanceof Error ? e.message : e);
    return { status: "error", message: "AI parsing is misconfigured. An administrator should check the AI_* settings." };
  }
  if (!config.enabled) return { status: "error", message: `AI parsing is off. Still needed: ${config.missing.join(", ")}.` };

  const supabase = await createClient();
  const source = await loadResumeText(supabase, candidateId.data, resumeId.data);
  if (!source.ok) return { status: "error", message: source.error };

  const redacted = redactContactDetails(normalizeResumeText(source.text));
  const text = redacted.text.slice(0, config.maxInputChars);

  // Limits are checked (and the request logged) before any cost is incurred.
  const { data: parseId, error: beginError } = await supabase.rpc("begin_resume_parse", {
    p_candidate_id: candidateId.data,
    p_resume_id: source.resumeId,
    p_provider: config.provider,
    p_model: config.model,
    p_input_chars: text.length,
    p_hourly_limit: config.hourlyLimit,
    p_monthly_limit: config.monthlyLimit,
    p_monthly_token_budget: config.monthlyTokenBudget,
  });
  if (beginError || !parseId) return { status: "error", message: beginError ? dbMessage(beginError, "AI parsing couldn't start.") : "AI parsing couldn't start." };

  const result = await proposeWithOpenAI(fetch, { apiKey: config.apiKey, model: config.model, resumeText: text });
  const checked = result.ok ? checkProposal(result.json, text) : null;
  const error = !result.ok ? result.error : checked && !checked.ok ? checked.error : null;
  const proposal = checked?.ok ? { ...checked.proposal, truncated: redacted.text.length > text.length, redactions: redacted.redactions } : null;

  const { error: finishError } = await supabase.rpc("finish_resume_parse", {
    p_parse_id: parseId as string,
    p_proposal: proposal,
    p_input_tokens: result.inputTokens,
    p_output_tokens: result.outputTokens,
    p_error: error,
  });
  if (finishError) return { status: "error", message: dbMessage(finishError, "The AI result couldn't be saved.") };
  if (error) return { status: "error", message: `${error} Nothing was changed. You can try again or enter the details by hand.` };

  revalidatePath(`/recruiter/candidates/${candidateId.data}`);
  redirect(`/recruiter/candidates/${candidateId.data}/ai/${parseId as string}`);
}

type Applied = { headline: boolean; summary: boolean; location: boolean; skills: number; certifications: number; work_history: number; skipped: number };

const indexes = (formData: FormData, key: string) =>
  formData
    .getAll(key)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0);

/** Saves only the items the recruiter ticked, through the same tables and RLS as manual entry. */
export async function applyAiProposal(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getStaffUser();
  if (!user) return { status: "error", message: "Only recruiters and administrators can save candidate details." };
  const parseId = idSchema.safeParse(formString(formData, "parseId"));
  if (!parseId.success) return { status: "error", message: "Unknown suggestion." };

  const supabase = await createClient();
  const { data: parse } = await supabase.from("resume_parses").select("id, candidate_id, organization_id, status, proposal").eq("id", parseId.data).maybeSingle();
  if (!parse || parse.status !== "proposed") return { status: "error", message: "This suggestion was already reviewed or no longer exists." };
  const proposal = parse.proposal as ReviewedProposal;
  const candidateId = parse.candidate_id as string;
  const org = parse.organization_id as string;
  const applied: Applied = { headline: false, summary: false, location: false, skills: 0, certifications: 0, work_history: 0, skipped: 0 };

  // Profile fields: the recruiter may have edited the text before saving.
  const profile: Record<string, string> = {};
  for (const key of ["headline", "summary", "location"] as const) {
    if (formData.get(`use_${key}`) !== "on") continue;
    const value = formString(formData, key).trim();
    const max = key === "summary" ? 5000 : 200;
    if (value && value.length <= max) {
      profile[key] = value;
      applied[key] = true;
    }
  }
  if (Object.keys(profile).length) {
    const { error } = await supabase.from("candidates").update(profile).eq("id", candidateId);
    if (error) return { status: "error", message: dbMessage(error, "The profile fields couldn't be saved.") };
  }

  const { data: existingSkills } = await supabase.from("candidate_skills").select("name_normalized").eq("candidate_id", candidateId);
  const have = new Set(((existingSkills ?? []) as { name_normalized: string }[]).map((s) => s.name_normalized));
  const skillRows = indexes(formData, "skill")
    .map((i) => proposal.skills[i])
    .filter((s) => s && !have.has(s.name.trim().toLowerCase()))
    .map((s) => ({ organization_id: org, candidate_id: candidateId, name: s.name.trim(), years_experience: s.years_experience, created_by: user.id }));
  applied.skipped += indexes(formData, "skill").length - skillRows.length;

  const certRows = indexes(formData, "certification")
    .map((i) => proposal.certifications[i])
    .filter(Boolean)
    .map((c) => ({ organization_id: org, candidate_id: candidateId, name: c.name, issuer: c.issuer, created_by: user.id }));

  const workRows = indexes(formData, "work")
    .map((i) => proposal.work_history[i])
    .filter(Boolean)
    .map((w) => {
      const start = w.start_month ? `${w.start_month}-01` : null;
      const end = w.is_current ? null : w.end_month ? `${w.end_month}-01` : null;
      return {
        organization_id: org,
        candidate_id: candidateId,
        company_name: w.company,
        title: w.title,
        location: w.location,
        start_date: start,
        end_date: start && end && end < start ? null : end,
        is_current: w.is_current,
        description: w.description,
        created_by: user.id,
      };
    });

  const inserts: [string, Record<string, unknown>[], "skills" | "certifications" | "work_history"][] = [
    ["candidate_skills", skillRows, "skills"],
    ["candidate_certifications", certRows, "certifications"],
    ["candidate_work_history", workRows, "work_history"],
  ];
  for (const [table, rows, key] of inserts) {
    if (!rows.length) continue;
    const { error } = await supabase.from(table).insert(rows);
    if (error) return { status: "error", message: dbMessage(error, `Some ${key.replace("_", " ")} couldn't be saved. Nothing else was marked as reviewed.`) };
    applied[key] = rows.length;
  }

  const { error } = await supabase.rpc("review_resume_parse", { p_parse_id: parseId.data, p_status: "applied", p_applied_summary: applied });
  if (error) return { status: "error", message: dbMessage(error, "The review couldn't be recorded.") };
  revalidatePath(`/recruiter/candidates/${candidateId}`);
  redirect(`/recruiter/candidates/${candidateId}?notice=ai-applied`);
}

export async function discardAiProposal(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getStaffUser())) return { status: "error", message: "Only recruiters and administrators can review suggestions." };
  const parseId = idSchema.safeParse(formString(formData, "parseId"));
  const candidateId = formString(formData, "candidateId");
  if (!parseId.success) return { status: "error", message: "Unknown suggestion." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_resume_parse", { p_parse_id: parseId.data, p_status: "discarded", p_applied_summary: null });
  if (error) return { status: "error", message: dbMessage(error, "The suggestion couldn't be discarded.") };
  revalidatePath(`/recruiter/candidates/${candidateId}`);
  redirect(`/recruiter/candidates/${candidateId}?notice=ai-discarded`);
}
