import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { SignUpForm } from "@/components/auth/auth-forms";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { getSessionUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };

export default async function SignUpPage() {
  if (await getSessionUser()) redirect("/account");

  const configured = isSupabaseConfigured();

  return (
    <AuthCard
      title="Create a candidate account"
      description="Job seekers can register here. Employer and staff accounts are set up by CoreTech."
      footer={
        configured && (
          <p>
            Already have an account?{" "}
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        )
      }
    >
      {configured ? <SignUpForm /> : <AuthNotConfigured />}
    </AuthCard>
  );
}
