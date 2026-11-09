"use client";

import { XIcon } from "lucide-react";
import { useActionState } from "react";

import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Badge } from "@/components/ui/badge";
import { APP_ROLES, type AppRole, ROLE_LABELS } from "@/lib/auth/roles";
import { initialFormState } from "@/lib/forms";

import { changeUserRole } from "./actions";

type UserRoleManagerProps = {
  userId: string;
  userLabel: string;
  roles: AppRole[];
  /** False for the signed-in admin's own row — the database refuses self-changes too. */
  editable: boolean;
};

export function UserRoleManager({ userId, userLabel, roles, editable }: UserRoleManagerProps) {
  const [state, action] = useActionState(changeUserRole, initialFormState);
  const assignable = APP_ROLES.filter((role) => !roles.includes(role));

  return (
    <div className="grid gap-2">
      <ul className="flex flex-wrap gap-1.5" aria-label={`Roles for ${userLabel}`}>
        {roles.length === 0 && <li className="text-sm text-muted-foreground">No roles</li>}
        {roles.map((role) => (
          <li key={role}>
            <Badge variant="secondary" className="h-7 gap-1 pr-1">
              {ROLE_LABELS[role]}
              {editable && (
                <form action={action}>
                  <input type="hidden" name="intent" value="revoke" />
                  <input type="hidden" name="userId" value={userId} />
                  <input type="hidden" name="role" value={role} />
                  <SubmitButton
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${ROLE_LABELS[role]} role from ${userLabel}`}
                  >
                    <XIcon />
                  </SubmitButton>
                </form>
              )}
            </Badge>
          </li>
        ))}
      </ul>

      {editable && assignable.length > 0 && (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="intent" value="assign" />
          <input type="hidden" name="userId" value={userId} />
          <label htmlFor={`assign-${userId}`} className="sr-only">
            Role to assign to {userLabel}
          </label>
          <select
            id={`assign-${userId}`}
            name="role"
            required
            defaultValue=""
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <option value="" disabled>
              Add role…
            </option>
            {assignable.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <SubmitButton variant="outline" size="sm" pendingLabel="Saving…">
            Assign
          </SubmitButton>
        </form>
      )}

      {!editable && <p className="text-xs text-muted-foreground">You can&apos;t change your own roles.</p>}

      <FormMessage state={state} />
    </div>
  );
}
