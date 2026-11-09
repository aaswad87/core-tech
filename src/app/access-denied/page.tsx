import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Access denied", robots: { index: false } };

export default function AccessDeniedPage() {
  return (
    <Container className="max-w-xl py-20 text-center">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">403</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">You don&apos;t have access to this page</h1>
      <p className="mt-4 text-muted-foreground">
        Your account doesn&apos;t have the role this page requires. If you think this is a mistake, contact a CoreTech
        administrator.
      </p>
      <Button asChild size="lg" className="mt-8">
        <Link href="/account">Go to your account</Link>
      </Button>
    </Container>
  );
}
