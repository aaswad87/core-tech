import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth/session";
import {
  LEAD_STATUSES,
  LEAD_TYPES,
  leadTypeLabel,
  specialtyLabel,
  timelineLabel,
  topicLabel,
} from "@/lib/leads/labels";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { LeadStatusForm } from "./lead-status-form";

export const metadata: Metadata = { title: "Leads", robots: { index: false } };

const PAGE_SIZE = 50;

type LeadRow = {
  id: string;
  type: string;
  status: string;
  full_name: string;
  email: string;
  phone: string | null;
  topic: string | null;
  company_name: string | null;
  contact_title: string | null;
  role_title: string | null;
  location: string | null;
  positions_count: number | null;
  timeline: string | null;
  specialty: string | null;
  job_id: string | null;
  message: string | null;
  source_path: string | null;
  created_at: string;
};

const dateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Chicago",
});

function filterHref(status: string, type: string) {
  const params = new URLSearchParams();
  if (status !== "new") params.set("status", status);
  if (type) params.set("type", type);
  const qs = params.toString();
  return qs ? `/admin/leads?${qs}` : "/admin/leads";
}

export default async function LeadsPage({ searchParams }: PageProps<"/admin/leads">) {
  await requireRole(["admin", "recruiter"], "/admin/leads");
  const params = await searchParams;
  const status = LEAD_STATUSES.some((s) => s.value === params.status) ? (params.status as string) : "new";
  const type = LEAD_TYPES.some((t) => t.value === params.type) ? (params.type as string) : "";

  const supabase = await createClient();
  let query = supabase
    .from("leads")
    .select(
      "id, type, status, full_name, email, phone, topic, company_name, contact_title, role_title, location, positions_count, timeline, specialty, job_id, message, source_path, created_at",
    )
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (type) query = query.eq("type", type);

  const { data, error } = await query;
  const leads = (data ?? []) as LeadRow[];

  return (
    <Container className="py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Leads</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Inquiries from the public website. Visible to recruiters and administrators only. Status changes are recorded in
        the audit log.
      </p>

      <nav aria-label="Filter leads" className="mt-8 grid gap-3">
        <ul className="flex flex-wrap gap-2">
          {LEAD_STATUSES.map((s) => (
            <li key={s.value}>
              <Link
                href={filterHref(s.value, type)}
                aria-current={s.value === status ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-full border px-3 text-sm",
                  s.value === status ? "border-night bg-night text-white" : "border-border hover:bg-muted",
                )}
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-2">
          {[{ value: "", label: "All types" }, ...LEAD_TYPES].map((t) => (
            <li key={t.value || "all"}>
              <Link
                href={filterHref(status, t.value)}
                aria-current={t.value === type ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-full border px-3 text-sm",
                  t.value === type ? "border-brand bg-accent text-ink" : "border-border hover:bg-muted",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {error ? (
        <p role="alert" className="mt-8 text-destructive">
          Leads could not be loaded. Please refresh the page.
        </p>
      ) : leads.length === 0 ? (
        <p className="mt-8 text-muted-foreground">No leads in this view.</p>
      ) : (
        <ul className="mt-6 grid gap-4">
          {leads.map((lead) => {
            const details = [
              lead.topic && ["Topic", topicLabel(lead.topic)],
              lead.company_name && ["Company", lead.company_name],
              lead.contact_title && ["Title", lead.contact_title],
              lead.role_title && ["Hiring for", lead.role_title],
              lead.positions_count && ["Openings", String(lead.positions_count)],
              lead.timeline && ["Timeline", timelineLabel(lead.timeline)],
              lead.specialty && ["Area", specialtyLabel(lead.specialty)],
              lead.location && ["Location", lead.location],
              lead.phone && ["Phone", lead.phone],
              lead.source_path && ["Submitted from", lead.source_path],
            ].filter(Boolean) as [string, string][];

            return (
              <li key={lead.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{leadTypeLabel(lead.type)}</Badge>
                      <time dateTime={lead.created_at} className="text-sm text-muted-foreground">
                        {dateTime.format(new Date(lead.created_at))} CT
                      </time>
                    </div>
                    <h2 className="mt-2 text-lg font-semibold text-ink">{lead.full_name}</h2>
                    <a href={`mailto:${lead.email}`} className="text-sm break-all text-brand hover:underline">
                      {lead.email}
                    </a>
                  </div>
                  <LeadStatusForm leadId={lead.id} status={lead.status} label={lead.full_name} />
                </div>
                {details.length > 0 && (
                  <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    {details.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="break-words">{v}</dd>
                      </div>
                    ))}
                    {lead.job_id && (
                      <div className="contents">
                        <dt className="text-muted-foreground">Job</dt>
                        <dd>
                          <Link href={`/jobs/${lead.job_id}`} className="text-brand hover:underline">
                            View job posting
                          </Link>
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
                {lead.message && (
                  <p className="mt-4 rounded-lg bg-muted p-3 text-sm whitespace-pre-line">{lead.message}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {leads.length === PAGE_SIZE && (
        <p className="mt-6 text-sm text-muted-foreground">
          Showing the {PAGE_SIZE} most recent leads in this view. Close or reclassify leads to see older ones.
        </p>
      )}
    </Container>
  );
}
