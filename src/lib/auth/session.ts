import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { type AppRole, appRoleSchema, hasAnyRole, STAFF_ROLES } from "@/lib/auth/roles";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type SessionUser = {
  id: string;
  email: string | null;
  roles: AppRole[];
};

/**
 * The signed-in user with their roles, or null. Claims are verified by Supabase (getClaims),
 * and roles are read from user_roles under RLS — never from the JWT or user metadata.
 * Cached per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Session-dependent output must never be prerendered, even when Supabase is not configured at build time.
  await connection();
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  const userId = data.claims.sub;
  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (rolesError) {
    // Fail closed: an authenticated user whose roles cannot be loaded gets no roles.
    console.error("Failed to load user roles", rolesError.message);
  }

  const roles = (roleRows ?? [])
    .map((row) => appRoleSchema.safeParse(row.role))
    .filter((result) => result.success)
    .map((result) => result.data);

  return {
    id: userId,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
    roles,
  };
});

/** Redirects to sign-in when there is no session. */
export async function requireUser(nextPath: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

/** For server actions: the signed-in staff user (admin or recruiter), or null. Never redirects. */
export async function getStaffUser(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  return user && hasAnyRole(user.roles, STAFF_ROLES) ? user : null;
}

/** Redirects to sign-in when signed out, and to /access-denied when the user lacks every allowed role. */
export async function requireRole(allowed: readonly AppRole[], nextPath: string): Promise<SessionUser> {
  const user = await requireUser(nextPath);
  if (!hasAnyRole(user.roles, allowed)) redirect("/access-denied");
  return user;
}
