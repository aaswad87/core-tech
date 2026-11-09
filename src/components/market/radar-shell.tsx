import { CheckCircle2Icon, CircleDashedIcon } from "lucide-react";

import { NavLink } from "@/components/layout/nav-link";
import { getRadarSetupStatus } from "@/lib/market/queries";

export function RadarTabs() {
  const cls =
    "rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
  return (
    <nav aria-label="Job Radar" className="flex flex-wrap gap-2">
      <NavLink href="/recruiter/market" className={cls} activeClassName="bg-brand-50 text-brand-700">
        Matches
      </NavLink>
      <NavLink href="/recruiter/market/hunts" className={cls} activeClassName="bg-brand-50 text-brand-700">
        Hunts &amp; sources
      </NavLink>
    </nav>
  );
}

/** Shows which sources and alert channels are configured (booleans only — never key values). */
export function RadarSetupPanel() {
  const status = getRadarSetupStatus();
  if (!status.ok) {
    return (
      <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Job Radar settings are invalid: {status.error}
      </p>
    );
  }
  const items = [
    { label: "JSearch — Indeed, Dice, LinkedIn & company sites", on: status.jsearch, env: "JSEARCH_RAPIDAPI_KEY" },
    { label: "Adzuna", on: status.adzuna, env: "ADZUNA_APP_ID / ADZUNA_APP_KEY" },
    { label: "Greenhouse & Lever career sites", on: true, env: "No key needed — add companies below" },
    { label: "Email alerts", on: status.email, env: "RESEND_API_KEY / MARKET_ALERTS_FROM" },
    { label: "Slack alerts", on: status.slack, env: "SLACK_MARKET_WEBHOOK_URL (optional)" },
    { label: "Automatic scans", on: status.cron, env: "CRON_SECRET + scheduler" },
  ];
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => (
        <li key={i.label} className="flex items-start gap-2 rounded-xl border border-border bg-background p-3 text-sm">
          {i.on ? (
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <CircleDashedIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span>
            <span className="font-medium text-ink">{i.label}</span>
            <span className="sr-only">{i.on ? " — configured" : " — not configured"}</span>
            {!i.on && <span className="block text-xs text-muted-foreground">Set {i.env}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
