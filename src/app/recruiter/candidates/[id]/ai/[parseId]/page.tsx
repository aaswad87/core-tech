import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AiReviewForm } from "@/components/ai/forms";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import type { ReviewedProposal } from "@/lib/ai/proposal";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { fullName } from "@/lib/candidates/format";
import { idSchema } from "@/lib/candidates/validation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review AI suggestions" };

const STATUS: Record<string, string> = { proposed: "Waiting for review", applied: "Saved", discarded: "Discarded", failed: "Failed", pending: "Running" };

export default async function AiReviewPage({ params }: PageProps<"/recruiter/candidates/[id]/ai/[parseId]">) {
  const { id, parseId } = await params;
  await requireRole(STAFF_ROLES, `/recruiter/candidates/${id}`);
  if (!idSchema.safeParse(id).success || !idSchema.safeParse(parseId).success) notFound();

  const supabase = await createClient();
  const { data: parse } = await supabase
    .from("resume_parses")
    .select("id, status, model, proposal, error, applied_summary, created_at, input_tokens, output_tokens, candidate_resumes(file_name), candidates(first_name, last_name)")
    .eq("id", parseId)
    .eq("candidate_id", id)
    .maybeSingle();
  if (!parse) notFound();

  const candidate = parse.candidates as unknown as { first_name: string; last_name: string } | null;
  const resume = parse.candidate_resumes as unknown as { file_name: string } | null;
  const proposal = parse.proposal as (ReviewedProposal & { truncated?: boolean; redactions?: number }) | null;

  return (
    <Container className="grid max-w-3xl gap-6 py-10">
      <div>
        <Link href={`/recruiter/candidates/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← {candidate ? fullName(candidate) : "Candidate"}
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight text-ink">
          AI suggestions
          <Badge variant="outline">{STATUS[parse.status as string] ?? parse.status}</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          From {resume?.file_name ?? "a resume"} · model {parse.model as string}
          {parse.input_tokens != null && ` · ${(parse.input_tokens as number) + ((parse.output_tokens as number | null) ?? 0)} tokens`}
        </p>
      </div>

      <div className="rounded-xl border border-brand/30 bg-brand-50/40 p-4 text-sm">
        <p className="font-medium text-ink">Nothing is saved until you choose.</p>
        <p className="mt-1 text-muted-foreground">
          These are suggestions read from the resume. Check each one against its quote. Items whose quote wasn&apos;t found in the resume, and
          low-confidence items, start unticked. The AI was told to ignore anything not job-related, and it never judges or ranks candidates.
          {proposal?.redactions ? ` Contact details (${proposal.redactions}) were removed before sending.` : ""}
          {proposal?.truncated ? " The resume was long, so only the first part was read." : ""}
        </p>
      </div>

      {parse.status === "proposed" && proposal ? (
        <AiReviewForm parseId={parse.id as string} candidateId={id} proposal={proposal} />
      ) : parse.status === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          {(parse.error as string) ?? "The request failed."} Nothing was changed.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {parse.status === "applied" ? "These suggestions were reviewed and the selected items saved." : "These suggestions were discarded."}
        </p>
      )}
    </Container>
  );
}
