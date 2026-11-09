"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { siteConfig } from "@/config/site";
import { getStaffUser } from "@/lib/auth/session";
import { idSchema } from "@/lib/candidates/validation";
import { getMarketConfig, isLeadCaptureConfigured } from "@/lib/env.server";
import { type FormState, formString } from "@/lib/forms";
import { createSupabaseMarketRepo } from "@/lib/market/repo";
import { runMarketScan } from "@/lib/market/scan";
import { huntSchema, matchStatusSchema, watchCompanySchema } from "@/lib/market/validation";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";

const NOT_STAFF: FormState = { status: "error", message: "Only recruiters and administrators can use Job Radar." };
const FAILED: FormState = { status: "error", message: "That change could not be saved. Please try again." };

async function staffContext() {
  const user = await getStaffUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  if (!data) return null;
  return { user, supabase, organizationId: data.organization_id as string };
}

function revalidateRadar() {
  revalidatePath("/recruiter/market");
  revalidatePath("/recruiter/market/hunts");
}

// --- Scans --------------------------------------------------------------------

export async function runScanNow(): Promise<FormState> {
  const user = await getStaffUser();
  if (!user) return NOT_STAFF;
  if (!isLeadCaptureConfigured()) {
    return { status: "error", message: "Job Radar needs the Supabase secret key (SUPABASE_SECRET_KEY) to run scans." };
  }

  let config;
  try {
    config = getMarketConfig();
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Job Radar settings are invalid." };
  }

  try {
    const result = await runMarketScan({
      repo: createSupabaseMarketRepo(),
      config,
      fetchImpl: fetch,
      appUrl: siteConfig.url,
      trigger: "manual",
      triggeredBy: user.id,
    });
    revalidateRadar();
    if (result.status === "skipped") return { status: "error", message: result.reason };
    const s = result.stats;
    const summary = `Checked ${s.requests} ${s.requests === 1 ? "source" : "sources"}, saw ${s.postings} postings, found ${s.newMatches} new ${s.newMatches === 1 ? "match" : "matches"}.`;
    if (result.status === "failed") return { status: "error", message: `Scan failed. ${summary} See the last run details below.` };
    return {
      status: "success",
      message: `${summary}${s.emailsSent ? ` Email alerts accepted for ${s.emailsSent} ${s.emailsSent === 1 ? "person" : "people"}.` : ""}${result.status === "partial" ? " Some sources had errors — see details below." : ""}`,
    };
  } catch (e) {
    console.error("Manual market scan failed", e);
    return { status: "error", message: "The scan could not run. Please try again." };
  }
}

// --- Hunts --------------------------------------------------------------------

function readHunt(formData: FormData) {
  return {
    name: formString(formData, "name"),
    keywords: formString(formData, "keywords"),
    excludeKeywords: formString(formData, "excludeKeywords"),
    locations: formString(formData, "locations"),
    includeRemote: formString(formData, "includeRemote"),
    sources: formData.getAll("sources").filter((v): v is string => typeof v === "string"),
    minScore: formString(formData, "minScore"),
  };
}

export async function saveHunt(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staffContext();
  if (!ctx) return NOT_STAFF;

  const raw = readHunt(formData);
  const values = { ...raw, sources: raw.sources.join(",") };
  const parsed = huntSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };

  const huntId = formString(formData, "huntId");
  const columns = {
    name: parsed.data.name,
    keywords: parsed.data.keywords,
    exclude_keywords: parsed.data.excludeKeywords,
    locations: parsed.data.locations,
    include_remote: parsed.data.includeRemote,
    sources: parsed.data.sources,
    min_score: parsed.data.minScore,
  };

  if (huntId) {
    if (!idSchema.safeParse(huntId).success) return { status: "error", message: "Unknown hunt." };
    const { data, error } = await ctx.supabase.from("market_hunts").update(columns).eq("id", huntId).select("id");
    if (error || !data?.length) return { ...FAILED, values };
  } else {
    const { data, error } = await ctx.supabase
      .from("market_hunts")
      .insert({ ...columns, organization_id: ctx.organizationId, created_by: ctx.user.id })
      .select("id")
      .single();
    if (error || !data) return { ...FAILED, values };
    // The creator gets the alerts by default.
    await ctx.supabase.from("market_hunt_subscribers").insert({ hunt_id: data.id, user_id: ctx.user.id });
  }

  revalidateRadar();
  redirect(`/recruiter/market/hunts?notice=${huntId ? "hunt-updated" : "hunt-created"}`);
}

export async function huntCommand(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staffContext();
  if (!ctx) return NOT_STAFF;
  const huntId = idSchema.safeParse(formString(formData, "huntId"));
  if (!huntId.success) return { status: "error", message: "Unknown hunt." };
  const command = formString(formData, "command");

  let error: { message: string } | null = null;
  let affected = 1;
  if (command === "subscribe") {
    ({ error } = await ctx.supabase.from("market_hunt_subscribers").insert({ hunt_id: huntId.data, user_id: ctx.user.id }));
    if (error?.message.includes("duplicate")) error = null;
  } else if (command === "unsubscribe") {
    ({ error } = await ctx.supabase.from("market_hunt_subscribers").delete().eq("hunt_id", huntId.data).eq("user_id", ctx.user.id));
  } else if (command === "pause" || command === "resume") {
    const res = await ctx.supabase.from("market_hunts").update({ is_active: command === "resume" }).eq("id", huntId.data).select("id");
    error = res.error;
    affected = res.data?.length ?? 0;
  } else if (command === "delete") {
    const res = await ctx.supabase.from("market_hunts").delete().eq("id", huntId.data).select("id");
    error = res.error;
    affected = res.data?.length ?? 0;
    if (!error && !affected) return { status: "error", message: "Only the person who created this hunt or an administrator can delete it." };
  } else {
    return { status: "error", message: "Unknown action." };
  }

  if (error || !affected) return FAILED;
  revalidateRadar();
  const messages: Record<string, string> = {
    subscribe: "You'll get email alerts for this hunt.",
    unsubscribe: "You won't get email alerts for this hunt.",
    pause: "Hunt paused.",
    resume: "Hunt resumed.",
    delete: "Hunt deleted.",
  };
  return { status: "success", message: messages[command] };
}

// --- Watched company career sites ------------------------------------------------

export async function addWatchCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staffContext();
  if (!ctx) return NOT_STAFF;

  const values = {
    companyName: formString(formData, "companyName"),
    source: formString(formData, "source"),
    board: formString(formData, "board"),
  };
  const parsed = watchCompanySchema.safeParse(values);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };

  const { error } = await ctx.supabase.from("market_watch_companies").insert({
    organization_id: ctx.organizationId,
    company_name: parsed.data.companyName,
    source: parsed.data.source,
    board_token: parsed.data.boardToken,
    created_by: ctx.user.id,
  });
  if (error?.code === "23505") return { status: "error", fieldErrors: { board: "This career site is already being watched." }, values };
  if (error) return { ...FAILED, values };
  revalidateRadar();
  return { status: "success", message: `Watching ${parsed.data.companyName}'s career site.` };
}

export async function removeWatchCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staffContext();
  if (!ctx) return NOT_STAFF;
  const id = idSchema.safeParse(formString(formData, "id"));
  if (!id.success) return { status: "error", message: "Unknown company." };
  const { data, error } = await ctx.supabase.from("market_watch_companies").delete().eq("id", id.data).select("id");
  if (error || !data?.length) return FAILED;
  revalidateRadar();
  return { status: "success", message: "Removed." };
}

// --- Matches --------------------------------------------------------------------

export async function setMatchStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staffContext();
  if (!ctx) return NOT_STAFF;
  const id = idSchema.safeParse(formString(formData, "matchId"));
  const status = matchStatusSchema.safeParse(formString(formData, "status"));
  if (!id.success || !status.success) return { status: "error", message: "Unknown action." };

  const { data, error } = await ctx.supabase.from("market_matches").update({ status: status.data }).eq("id", id.data).select("id");
  if (error || !data?.length) return FAILED;
  revalidateRadar();
  revalidatePath(`/recruiter/market/${id.data}`);
  return { status: "success", message: status.data === "dismissed" ? "Dismissed." : "Status updated." };
}

/**
 * "Pursue": records the hiring company (reusing an existing record with the same name), saves the
 * posting as an internal draft job, and marks the match pursued. Nothing is sent to anyone.
 */
export async function pursueMatch(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await staffContext();
  if (!ctx) return NOT_STAFF;
  const id = idSchema.safeParse(formString(formData, "matchId"));
  if (!id.success) return { status: "error", message: "Unknown match." };

  const { data: match } = await ctx.supabase
    .from("market_matches")
    .select("id, status, pursued_job_id, market_postings(title, company_name, location, is_remote, url, description_snippet, source)")
    .eq("id", id.data)
    .maybeSingle();
  const posting = (match as unknown as {
    market_postings: {
      title: string;
      company_name: string | null;
      location: string | null;
      is_remote: boolean;
      url: string;
      description_snippet: string | null;
      source: string;
    } | null;
  } | null)?.market_postings;
  if (!match || !posting) return { status: "error", message: "This match no longer exists." };
  if (match.pursued_job_id) return { status: "error", message: "This posting is already being pursued." };

  const companyName = (posting.company_name ?? "Unknown company").slice(0, 200);
  const pattern = companyName.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: existing } = await ctx.supabase.from("companies").select("id").ilike("name", pattern).limit(1).maybeSingle();

  let companyId = existing?.id as string | undefined;
  if (!companyId) {
    const { data: created, error } = await ctx.supabase
      .from("companies")
      .insert({ organization_id: ctx.organizationId, name: companyName, created_by: ctx.user.id })
      .select("id")
      .single();
    if (error || !created) return FAILED;
    companyId = created.id as string;
  }

  const { data: job, error: jobError } = await ctx.supabase
    .from("jobs")
    .insert({
      organization_id: ctx.organizationId,
      company_id: companyId,
      title: posting.title.slice(0, 200),
      status: "draft",
      location: posting.location,
      work_arrangement: posting.is_remote ? "remote" : null,
      // Internal only: never published. Records where the opportunity came from.
      description: `Found by Job Radar (${posting.source}).\nOriginal posting: ${posting.url}\n\n${posting.description_snippet ?? ""}`.slice(0, 20000),
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (jobError || !job) return FAILED;

  const { error } = await ctx.supabase.from("market_matches").update({ status: "pursued", pursued_job_id: job.id }).eq("id", id.data);
  if (error) return FAILED;

  revalidateRadar();
  revalidatePath(`/recruiter/market/${id.data}`);
  revalidatePath("/recruiter/jobs");
  return { status: "success", message: `Saved ${companyName} and a draft job. Open the job to add candidates to its pipeline.` };
}
