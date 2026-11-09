import { InfoIcon } from "lucide-react";

import { LeadForm } from "@/components/leads/lead-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isLeadCaptureConfigured } from "@/lib/env.server";

/**
 * Server wrapper: renders the lead form only when submissions can actually be stored,
 * otherwise an honest notice instead of a form that cannot work.
 */
export function LeadFormSection(props: React.ComponentProps<typeof LeadForm>) {
  if (!isLeadCaptureConfigured()) {
    return (
      <Alert>
        <InfoIcon />
        <AlertTitle>This form isn&apos;t available yet</AlertTitle>
        <AlertDescription>
          {process.env.NODE_ENV === "production"
            ? "Online inquiries are temporarily unavailable. Please check back soon."
            : "Online inquiries are not enabled in this environment. Set the Supabase variables, including SUPABASE_SECRET_KEY, described in .env.example to turn them on."}
        </AlertDescription>
      </Alert>
    );
  }
  return <LeadForm {...props} />;
}
