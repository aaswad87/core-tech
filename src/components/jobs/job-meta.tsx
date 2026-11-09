import { BriefcaseIcon, BuildingIcon, CalendarIcon, MapPinIcon } from "lucide-react";

import { EMPLOYMENT_TYPE_LABELS, type PublicJobSummary, workArrangementLabel } from "@/lib/jobs/public-jobs";
import { cn } from "@/lib/utils";

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function formatPostedDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function JobMeta({ job, className }: { job: PublicJobSummary; className?: string }) {
  const arrangement = workArrangementLabel(job.work_arrangement);
  const items = [
    job.location && { icon: MapPinIcon, label: "Location", value: job.location },
    arrangement && { icon: BuildingIcon, label: "Work arrangement", value: arrangement },
    { icon: BriefcaseIcon, label: "Employment type", value: EMPLOYMENT_TYPE_LABELS[job.employment_type] },
    { icon: CalendarIcon, label: "Posted", value: formatPostedDate(job.published_at) },
  ].filter(Boolean) as { icon: typeof MapPinIcon; label: string; value: string }[];

  return (
    <dl className={cn("flex flex-wrap gap-x-5 gap-y-2 text-sm", className)}>
      {items.map(({ icon: Icon, label, value }) => (
        <div key={label} className="flex items-center gap-1.5">
          <dt>
            <Icon className="size-4" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
