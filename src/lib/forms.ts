import type { FieldErrors } from "@/lib/validation/auth";

/** Result returned by server actions to forms rendered with useActionState. */
export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: FieldErrors;
  /** Echoed non-secret values so the form can keep them after a failed submit. */
  values?: Record<string, string>;
};

export const initialFormState: FormState = { status: "idle" };

export function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
