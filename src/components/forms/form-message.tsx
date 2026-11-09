import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FormState } from "@/lib/forms";

export function FormMessage({ state }: { state: Pick<FormState, "status" | "message"> }) {
  if (state.status === "idle" || !state.message) return null;

  const isError = state.status === "error";
  return (
    <Alert
      variant={isError ? "destructive" : "default"}
      role={isError ? "alert" : "status"}
      className={isError ? undefined : "border-success/40 text-foreground"}
    >
      {isError ? <CircleAlertIcon /> : <CircleCheckIcon className="text-success" />}
      <AlertDescription className={isError ? undefined : "text-foreground"}>{state.message}</AlertDescription>
    </Alert>
  );
}
