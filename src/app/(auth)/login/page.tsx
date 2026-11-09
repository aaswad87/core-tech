import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { SignInForm } from "@/components/auth/auth-forms";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { FormMessage } from "@/components/forms/form-message";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSessionUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

const ERRORS: Record<string, string> = {
  "link-invalid": "That link is invalid or has expired. Please try again.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const errorKey = typeof params.error === "string" ? params.error : undefined;

  if (await getSessionUser()) redirect(next);

  const configured = isSupabaseConfigured();

  return (
    <AuthCard
      title="Sign in"
      description="Access your CoreTech Recruiting account."
      footer={
        configured && (
          <>
            <Link href="/forgot-password" className="text-primary underline-offset-4 hover:underline">
              Forgot your password?
            </Link>
            <p>
              New candidate?{" "}
              <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
                Create an account
              </Link>
            </p>
          </>
        )
      }
    >
      <div className="grid gap-4">
        {errorKey && ERRORS[errorKey] && <FormMessage state={{ status: "error", message: ERRORS[errorKey] }} />}
        {configured ? <SignInForm next={next} /> : <AuthNotConfigured />}
      </div>
    </AuthCard>
  );
}
