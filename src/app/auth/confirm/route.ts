import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (OTP_TYPES as readonly string[]).includes(value);
}

/**
 * Landing route for links in Supabase auth emails (signup confirmation, password recovery, invites).
 * Supports the token_hash email template (recommended — works across browsers) and the PKCE `code` flow.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const type = searchParams.get("type");
  const tokenHash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), type === "recovery" ? "/reset-password" : undefined);

  const failure = new URL("/login", request.url);
  failure.searchParams.set("error", "link-invalid");

  if (!isSupabaseConfigured()) return NextResponse.redirect(failure);

  const supabase = await createClient();

  if (tokenHash && isOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  return NextResponse.redirect(failure);
}
