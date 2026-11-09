import "server-only";

import { extractResumeText } from "@/lib/ai/resume-text";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Downloads a candidate's resume from private storage (as the signed-in staff user, so RLS applies) and
 * returns its text. With no resumeId, uses the most recent resume.
 */
export async function loadResumeText(
  supabase: Supabase,
  candidateId: string,
  resumeId?: string,
): Promise<{ ok: true; text: string; resumeId: string; fileName: string } | { ok: false; error: string }> {
  let query = supabase.from("candidate_resumes").select("id, storage_path, mime_type, file_name").eq("candidate_id", candidateId);
  query = resumeId ? query.eq("id", resumeId) : query.order("created_at", { ascending: false }).limit(1);
  const { data } = await query.maybeSingle();
  if (!data) return { ok: false, error: resumeId ? "That resume no longer exists." : "This candidate has no resume on file." };

  const { data: blob, error } = await supabase.storage.from("resumes").download(data.storage_path as string);
  if (error || !blob) {
    console.error("Resume download failed", error?.message);
    return { ok: false, error: "The resume file couldn't be loaded from storage." };
  }
  const extracted = await extractResumeText(new Uint8Array(await blob.arrayBuffer()), data.mime_type as string);
  if (!extracted.ok) return extracted;
  return { ok: true, text: extracted.text, resumeId: data.id as string, fileName: data.file_name as string };
}
