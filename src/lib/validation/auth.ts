import { z } from "zod";

import { appRoleSchema } from "@/lib/auth/roles";

export const emailSchema = z
  .string({ error: "Enter your email address." })
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "Email address is too long.")
  .pipe(z.email("Enter a valid email address."));

/** Matches supabase/config.toml: at least 10 characters with lower, upper and digit. */
export const newPasswordSchema = z
  .string({ error: "Enter a password." })
  .min(10, "Use at least 10 characters.")
  .refine((value) => new TextEncoder().encode(value).length <= 72, "Use at most 72 bytes.")
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value), {
    message: "Include an uppercase letter, a lowercase letter, and a number.",
  });

export const signInSchema = z.object({
  email: emailSchema,
  // Never validate strength at sign-in; just require a value.
  password: z.string({ error: "Enter your password." }).min(1, "Enter your password.").max(1024),
});

export const signUpSchema = z
  .object({
    fullName: z
      .string({ error: "Enter your name." })
      .trim()
      .min(1, "Enter your name.")
      .max(200, "Name is too long."),
    email: emailSchema,
    password: newPasswordSchema,
    confirmPassword: z.string({ error: "Confirm your password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string({ error: "Confirm your password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export const roleChangeSchema = z.object({
  userId: z.uuid("Invalid user."),
  role: appRoleSchema,
});

export type FieldErrors = Partial<Record<string, string>>;

/** Flattens a Zod error into one message per field for form display. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    result[key] ??= issue.message;
  }
  return result;
}
