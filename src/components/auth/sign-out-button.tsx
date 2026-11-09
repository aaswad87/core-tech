import { signOut } from "@/app/(auth)/actions";
import { SubmitButton } from "@/components/forms/submit-button";

export function SignOutButton(props: Omit<React.ComponentProps<typeof SubmitButton>, "children">) {
  return (
    <form action={signOut}>
      <SubmitButton variant="outline" pendingLabel="Signing out…" {...props}>
        Sign out
      </SubmitButton>
    </form>
  );
}
