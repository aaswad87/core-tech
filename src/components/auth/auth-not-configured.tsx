import { InfoIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Shown instead of auth forms when Supabase env vars are missing, so no form pretends to work. */
export function AuthNotConfigured() {
  return (
    <Alert>
      <InfoIcon />
      <AlertTitle>Accounts are not available yet</AlertTitle>
      <AlertDescription>
        Authentication has not been configured for this environment. Set the Supabase variables described in
        .env.example to enable sign-in.
      </AlertDescription>
    </Alert>
  );
}
