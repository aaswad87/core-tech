"use server";

import { redirect } from "next/navigation";

import { siteConfig } from "@/config/site";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSupabaseConfigured } from "@/lib/env";
import { type FormState, formString } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  toFieldErrors,
} from "@/lib/validation/auth";

const NOT_CONFIGURED: FormState = {
  status: "error",
  message: "Sign-in is not available yet because authentication has not been configured.",
};

function isRateLimited(error: { status?: number; code?: string }) {
  return error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit";
}

const RATE_LIMITED: FormState = {
  status: "error",
  message: "Too many attempts. Please wait a few minutes and try again.",
};

function confirmUrl(next: string) {
  return `${siteConfig.url}/auth/confirm?next=${encodeURIComponent(next)}`;
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const email = formString(formData, "email");
  const parsed = signInSchema.safeParse({ email, password: formString(formData, "password") });
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { email } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    if (isRateLimited(error)) return { ...RATE_LIMITED, values: { email } };
    if (error.code === "email_not_confirmed") {
      return {
        status: "error",
        message: "Please confirm your email address using the link we sent, then sign in.",
        values: { email },
      };
    }
    if (error.code === "invalid_credentials") {
      // Same message for unknown email and wrong password to avoid account enumeration.
      return { status: "error", message: "Email or password is incorrect.", values: { email } };
    }
    console.error("Sign-in failed", error.code, error.status, error.message);
    return { status: "error", message: "We couldn't sign you in right now. Please try again.", values: { email } };
  }

  redirect(safeNextPath(formString(formData, "next")));
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const values = { fullName: formString(formData, "fullName"), email: formString(formData, "email") };
  const parsed = signUpSchema.safeParse({
    ...values,
    password: formString(formData, "password"),
    confirmPassword: formString(formData, "confirmPassword"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: confirmUrl("/account"),
      // Display name only. Roles are assigned by the database, never from metadata.
      data: { full_name: parsed.data.fullName },
    },
  });

  if (error) {
    if (isRateLimited(error)) return { ...RATE_LIMITED, values };
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: "Choose a stronger password." }, values };
    }
    console.error("Sign-up failed", error.code, error.message);
    return { status: "error", message: "We couldn't create your account. Please try again.", values };
  }

  // Email confirmation disabled in this project: the user is signed in immediately.
  if (data.session) redirect("/account");

  return {
    status: "success",
    message: `Check ${parsed.data.email} for a confirmation link to finish creating your account. If you already have an account, sign in instead.`,
  };
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const email = formString(formData, "email");
  const parsed = forgotPasswordSchema.safeParse({ email });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { email } };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: confirmUrl("/reset-password"),
  });

  if (error) {
    if (isRateLimited(error)) return { ...RATE_LIMITED, values: { email } };
    console.error("Password reset request failed", error.code, error.message);
    return { status: "error", message: "We couldn't send a reset email. Please try again.", values: { email } };
  }

  // Same response whether or not the account exists.
  return {
    status: "success",
    message: `If an account exists for ${parsed.data.email}, we've sent a link to reset your password.`,
  };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const parsed = resetPasswordSchema.safeParse({
    password: formString(formData, "password"),
    confirmPassword: formString(formData, "confirmPassword"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return { status: "error", message: "Your reset link has expired. Request a new one to continue." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") {
      return { status: "error", fieldErrors: { password: "Choose a password you haven't used here before." } };
    }
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: "Choose a stronger password." } };
    }
    if (error.code === "reauthentication_needed") {
      return { status: "error", message: "For security, request a new reset link and try again." };
    }
    console.error("Password update failed", error.code, error.message);
    return { status: "error", message: "We couldn't update your password. Please try again." };
  }

  redirect("/account?notice=password-updated");
}

export async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}
