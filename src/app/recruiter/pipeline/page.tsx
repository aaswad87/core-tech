import { KanbanSquareIcon, TableIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { Container } from "@/components/layout/container";
import { PipelineView } from "@/components/pipeline/pipeline-view";
import { Button } from "@/components/ui/button";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getProfileNames } from "@/lib/candidates/queries";
import { listOpenJobsForPicker, listPipeline, PIPELINE_LIMIT } from "@/lib/jobs/staff-queries";
import { STAGE_VALUES, STAGES } from "@/lib/pipeline/stages";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: PageProps<"/recruiter/pipeline">) {
  const user = await requireRole(STAFF_ROLES, "/recruiter/pipeline");
  const sp = await searchParams;
  const view = sp.view === "board" ? "board" : "table";
  const jobId = z.uuid().safeParse(sp.job).success ? (sp.job as string) : null;
  const stage = (STAGE_VALUES as readonly string[]).includes(sp.stage as string) ? (sp.stage as string) : null;
  const mine = sp.mine === "1";

  const [cards, jobs] = await Promise.all([
    listPipeline({ jobId, stage, ownerId: mine ? user.id : null }),
    listOpenJobsForPicker(),
  ]);
  const names = await getProfileNames(cards.flatMap((c) => c.history.map((h) => h.actorId)));

  const params = new URLSearchParams();
  if (jobId) params.set("job", jobId);
  if (stage) params.set("stage", stage);
  if (mine) params.set("mine", "1");
  const withView = (v: string) => {
    const p = new URLSearchParams(params);
    if (v === "board") p.set("view", "board");
    const qs = p.toString();
    return qs ? `/recruiter/pipeline?${qs}` : "/recruiter/pipeline";
  };

  return (
    <Container className="max-w-none py-10 xl:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink">Pipeline</h1>
          <p className="mt-1 text-muted-foreground">Every candidate in an active process, across all jobs.</p>
        </div>
        <div className="flex gap-1 rounded-full border border-border bg-background p-1" role="group" aria-label="Pipeline view">
          <Button asChild size="sm" variant={view === "table" ? "default" : "ghost"} className="rounded-full">
            <Link href={withView("table")} aria-current={view === "table" ? "page" : undefined}>
              <TableIcon aria-hidden="true" /> Table
            </Link>
          </Button>
          <Button asChild size="sm" variant={view === "board" ? "default" : "ghost"} className="rounded-full">
            <Link href={withView("board")} aria-current={view === "board" ? "page" : undefined}>
              <KanbanSquareIcon aria-hidden="true" /> Board
            </Link>
          </Button>
        </div>
      </div>

      <form action="/recruiter/pipeline" className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-background p-4">
        {view === "board" && <input type="hidden" name="view" value="board" />}
        <div className="grid gap-1">
          <label htmlFor="pf-job" className="text-xs font-medium text-muted-foreground">Job</label>
          <select id="pf-job" name="job" defaultValue={jobId ?? ""} className="h-9 min-w-56 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="">All jobs</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
                {j.company ? ` — ${j.company}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="pf-stage" className="text-xs font-medium text-muted-foreground">Stage</label>
          <select id="pf-stage" name="stage" defaultValue={stage ?? ""} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="">All active stages</option>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} className="size-4 accent-brand" /> My candidates only
        </label>
        <Button type="submit" variant="outline" className="h-9">Apply filters</Button>
      </form>

      <div className="mt-6">
        <PipelineView cards={cards} view={view} showJob actorNames={Object.fromEntries(names)} />
      </div>
      {cards.length === PIPELINE_LIMIT && (
        <p className="mt-3 text-sm text-muted-foreground">Showing the {PIPELINE_LIMIT} most recently active. Filter by job or stage to see others.</p>
      )}
    </Container>
  );
}
