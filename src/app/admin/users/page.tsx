import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type AppRole, appRoleSchema, canManageRolesOf } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import { UserRoleManager } from "./user-role-manager";

export const metadata: Metadata = { title: "Users and roles", robots: { index: false } };

const PAGE_SIZE = 100;

/** Keeps search text safe to embed in a PostgREST filter expression. */
function sanitizeSearch(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[^\p{L}\p{N}@._+\- ]/gu, "").trim().slice(0, 100);
}

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const actor = await requireRole(["admin"], "/admin/users");
  const query = sanitizeSearch((await searchParams).q);

  const supabase = await createClient();
  let profilesQuery = supabase
    .from("profiles")
    .select("id, email, full_name, created_at")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (query) profilesQuery = profilesQuery.or(`email.ilike.%${query}%,full_name.ilike.%${query}%`);

  const { data: profiles, error } = await profilesQuery;
  const userIds = (profiles ?? []).map((p) => p.id);

  const { data: roleRows, error: rolesError } = userIds.length
    ? await supabase.from("user_roles").select("user_id, role").in("user_id", userIds)
    : { data: [], error: null };

  const rolesByUser = new Map<string, AppRole[]>();
  for (const row of roleRows ?? []) {
    const role = appRoleSchema.safeParse(row.role);
    if (!role.success) continue;
    rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), role.data]);
  }

  const loadFailed = Boolean(error || rolesError);

  return (
    <Container className="py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Users and roles</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        New sign-ups receive the Candidate role automatically. Assign Recruiter, Employer, or Administrator access
        here. Every change is recorded in the audit log.
      </p>

      <form role="search" className="mt-8 flex max-w-md gap-2">
        <label htmlFor="user-search" className="sr-only">
          Search by name or email
        </label>
        <Input id="user-search" name="q" type="search" defaultValue={query} placeholder="Search by name or email" className="h-9" />
        <Button type="submit" variant="outline" className="h-9">
          Search
        </Button>
      </form>

      {loadFailed ? (
        <p role="alert" className="mt-8 text-destructive">
          Users could not be loaded. Please refresh the page.
        </p>
      ) : (profiles ?? []).length === 0 ? (
        <p className="mt-8 text-muted-foreground">{query ? "No users match your search." : "No users yet."}</p>
      ) : (
        <div className="mt-6 rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="w-[55%]">Roles</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(profiles ?? []).map((profile) => {
                const label = profile.full_name ?? profile.email;
                return (
                  <TableRow key={profile.id} className="align-top">
                    <TableCell className="whitespace-normal">
                      <div className="font-medium text-foreground">{profile.full_name ?? "—"}</div>
                      <div className="text-sm break-all text-muted-foreground">{profile.email}</div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <UserRoleManager
                        userId={profile.id}
                        userLabel={label}
                        roles={rolesByUser.get(profile.id) ?? []}
                        editable={canManageRolesOf(actor, profile.id)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {(profiles ?? []).length === PAGE_SIZE && (
            <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
              Showing the {PAGE_SIZE} most recent users. Use search to find others.
            </p>
          )}
        </div>
      )}
    </Container>
  );
}
