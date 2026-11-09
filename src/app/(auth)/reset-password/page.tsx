import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { FormMessage } from "@/components/forms/form-message";
import { getSessionUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

/** Reached from the recovery email via /auth/confirm, which establishes a short-lived session. */
export default async function ResetPasswordPage() {
  const configured = isSupabaseConfigured();
  const user = configured ? await getSessionUser() : null;

  return (
    <AuthCard title="Choose a new password">
      {!configured ? (
        <AuthNotConfigured />
      ) : user ? (
        <ResetPasswordForm />
      ) : (
        <div className="grid gap-4">
          <FormMessage
            state={{ status: "error", message: "Your reset link is invalid or has expired." }}
          />
          <Link href="/forgot-password" className="text-primary underline-offset-4 hover:underline">
            Request a new reset link
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
