import Link from "next/link";

import type { DuplicateMatch } from "@/lib/candidates/types";

const REASON_LABELS = { email: "same email", phone: "same phone", name: "same name" } as const;

export function DuplicateList({ matches }: { matches: DuplicateMatch[] }) {
  return (
    <ul className="grid gap-2">
      {matches.map((m) => (
        <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <Link
            href={`/recruiter/candidates/${m.id}`}
            target="_blank"
            className="font-medium text-brand underline-offset-4 hover:underline"
          >
            {m.first_name} {m.last_name}
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
          <span className="text-muted-foreground">{[m.email, m.phone].filter(Boolean).join(" · ")}</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
            {m.match_reasons.map((r) => REASON_LABELS[r]).join(", ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
