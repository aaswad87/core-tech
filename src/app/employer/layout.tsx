import type { Metadata } from "next";
import { headers } from "next/headers";

import { safeNextPath } from "@/lib/auth/redirect";
import { requireRole } from "@/lib/auth/session";
import { PATHNAME_HEADER } from "@/lib/supabase/proxy";

export const metadata: Metadata = {
  title: { default: "Employer portal", template: "%s | Employer portal" },
  robots: { index: false, follow: false },
};

/** Employer-only area. Pages check company membership again; RLS and the database functions are the final gate. */
export default async function EmployerLayout({ children }: { children: React.ReactNode }) {
  const requested = safeNextPath((await headers()).get(PATHNAME_HEADER), "/employer");
  await requireRole(["employer"], requested.startsWith("/employer") ? requested : "/employer");
  return <div className="bg-surface/60 min-h-[calc(100dvh-4rem)]">{children}</div>;
}
