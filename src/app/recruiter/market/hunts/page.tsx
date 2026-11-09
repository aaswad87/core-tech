import { BellIcon, BellOffIcon, PencilIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { FormMessage } from "@/components/forms/form-message";
import { Container } from "@/components/layout/container";
import { HuntCommandButton, RemoveWatchCompanyButton, WatchCompanyForm } from "@/components/market/radar-forms";
import { RadarSetupPanel, RadarTabs } from "@/components/market/radar-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isAdmin, STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/candidates/format";
import { listHunts, listWatchCompanies } from "@/lib/market/queries";
import { SOURCE_SHORT_LABELS } from "@/lib/market/types";

export const metadata: Metadata = { title: "Hunts & sources" };

const NOTICES: Record<string, string> = {
  "hunt-created": "Hunt created. You're subscribed to its email alerts.",
  "hunt-updated": "Hunt saved.",
};

export default async function HuntsPage({ searchParams }: PageProps<"/recruiter/market/hunts">) {
  const user = await requireRole(STAFF_ROLES, "/recruiter/market/hunts");
  const { notice } = await searchParams;
  const [hunts, companies] = await Promise.all([listHunts(), listWatchCompanies()]);

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink">Hunts &amp; sources</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Hunts describe what to look for. Subscribe to a hunt to get its email alerts.
          </p>
        </div>
        <Button asChild className="h-10 rounded-full px-5">
          <Link href="/recruiter/market/hunts/new">
            <PlusIcon aria-hidden="true" /> New hunt
          </Link>
        </Button>
      </div>
      <div className="mt-6">
        <RadarTabs />
      </div>

      {typeof notice === "string" && NOTICES[notice] && (
        <div className="mt-6">
          <FormMessage state={{ status: "success", message: NOTICES[notice] }} />
        </div>
      )}

      <section aria-labelledby="hunts-heading" className="mt-8">
        <h2 id="hunts-heading" className="text-xl font-semibold text-ink">
          Hunts
        </h2>
        {hunts.length === 0 ? (
          <p className="mt-3 text-muted-foreground">No hunts yet.</p>
        ) : (
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {hunts.map((h) => {
              const subscribed = h.market_hunt_subscribers.some((s) => s.user_id === user.id);
              const canDelete = h.created_by === user.id || isAdmin(user.roles);
              return (
                <li key={h.id} className="rounded-2xl border border-border bg-background p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold text-ink">{h.name}</h3>
                    <Badge variant={h.is_active ? "secondary" : "outline"}>{h.is_active ? "Active" : "Paused"}</Badge>
                  </div>
                  <dl className="mt-3 grid gap-1.5 text-sm">
                    <div>
                      <dt className="inline text-muted-foreground">Keywords: </dt>
                      <dd className="inline">{h.keywords.join(", ")}</dd>
                    </div>
                    <div>
                      <dt className="inline text-muted-foreground">Locations: </dt>
                      <dd className="inline">
                        {h.locations.length ? h.locations.join(", ") : "Anywhere in the US"}
                        {h.include_remote && " + remote"}
                      </dd>
                    </div>
                    {h.exclude_keywords.length > 0 && (
                      <div>
                        <dt className="inline text-muted-foreground">Excluding: </dt>
                        <dd className="inline">{h.exclude_keywords.join(", ")}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="inline text-muted-foreground">Sources: </dt>
                      <dd className="inline">{h.sources.map((s) => SOURCE_SHORT_LABELS[s]).join(", ")}</dd>
                    </div>
                    <div>
                      <dt className="inline text-muted-foreground">Alerts go to: </dt>
                      <dd className="inline">
                        {h.market_hunt_subscribers.length} {h.market_hunt_subscribers.length === 1 ? "person" : "people"}
                        {subscribed && " (including you)"}
                      </dd>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {h.last_scanned_at ? `Last scanned ${formatDateTime(h.last_scanned_at)}` : "Not scanned yet"} · minimum fit {h.min_score}
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap items-start gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/recruiter/market/hunts/${h.id}/edit`}>
                        <PencilIcon aria-hidden="true" /> Edit
                      </Link>
                    </Button>
                    <HuntCommandButton
                      huntId={h.id}
                      command={subscribed ? "unsubscribe" : "subscribe"}
                      label={subscribed ? "Stop my alerts" : "Email me alerts"}
                    />
                    <HuntCommandButton huntId={h.id} command={h.is_active ? "pause" : "resume"} label={h.is_active ? "Pause" : "Resume"} variant="ghost" />
                    {canDelete && <HuntCommandButton huntId={h.id} command="delete" label="Delete" confirm />}
                  </div>
                  <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    {subscribed ? <BellIcon className="size-3.5" aria-hidden="true" /> : <BellOffIcon className="size-3.5" aria-hidden="true" />}
                    {subscribed ? "You get email alerts for this hunt." : "You don't get email alerts for this hunt."}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="careers-heading" className="mt-12">
        <h2 id="careers-heading" className="text-xl font-semibold text-ink">
          Company career sites
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Watch specific employers&apos; own career pages when they use Greenhouse (links like boards.greenhouse.io/company)
          or Lever (jobs.lever.co/company). Large employers on other systems — like AT&amp;T — are covered through JSearch,
          which indexes company career sites via Google for Jobs.
        </p>
        <div className="mt-4">
          <WatchCompanyForm />
        </div>
        {companies.length > 0 && (
          <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-background">
            {companies.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <span className="font-medium text-ink">{c.company_name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {SOURCE_SHORT_LABELS[c.source]} · {c.board_token}
                  </span>
                </span>
                <RemoveWatchCompanyButton id={c.id} name={c.company_name} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="setup-heading" className="mt-12">
        <h2 id="setup-heading" className="text-xl font-semibold text-ink">
          Connections
        </h2>
        <p className="mt-2 mb-4 text-sm text-muted-foreground">Set these in the server environment (see README → Job Radar).</p>
        <RadarSetupPanel />
      </section>
    </Container>
  );
}
