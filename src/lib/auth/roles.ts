import { z } from "zod";

/** Mirrors the `public.app_role` enum in supabase/migrations. */
export const APP_ROLES = ["admin", "recruiter", "employer", "candidate"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const appRoleSchema = z.enum(APP_ROLES);

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  recruiter: "Recruiter",
  employer: "Employer",
  candidate: "Candidate",
};

export const STAFF_ROLES: readonly AppRole[] = ["admin", "recruiter"];

export function hasAnyRole(roles: readonly AppRole[], allowed: readonly AppRole[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

export function isStaff(roles: readonly AppRole[]): boolean {
  return hasAnyRole(roles, STAFF_ROLES);
}

export function isAdmin(roles: readonly AppRole[]): boolean {
  return roles.includes("admin");
}

/**
 * UI-level check that mirrors public.assign_role/revoke_role. The database function is the
 * real enforcement point; this only decides which controls to render.
 */
export function canManageRolesOf(actor: { id: string; roles: readonly AppRole[] }, targetUserId: string): boolean {
  return isAdmin(actor.roles) && actor.id !== targetUserId;
}
