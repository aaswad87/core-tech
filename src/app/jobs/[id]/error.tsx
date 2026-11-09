"use client";

import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";

export default function JobError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Container className="max-w-xl py-20 text-center">
      <h1 className="text-2xl font-semibold text-ink">This job couldn&apos;t be loaded</h1>
      <p className="mt-3 text-muted-foreground">Something went wrong on our side. Please try again.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/jobs">All jobs</Link>
        </Button>
      </div>
    </Container>
  );
}
