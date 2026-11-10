import { WifiOffIcon } from "lucide-react";
import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { GradientMesh } from "@/components/marketing/gradient-mesh";
import { RetryButton } from "@/components/pwa/retry-button";

export const metadata: Metadata = { title: "You're offline", robots: { index: false } };

/**
 * Shown by the service worker when a page can't be loaded because the device is offline.
 * The worker caches it at install time without cookies, so the cached copy never contains
 * signed-in state or personal data.
 */
export default function OfflinePage() {
  return (
    <section className="relative overflow-hidden">
      <GradientMesh />
      <Container className="relative max-w-xl py-24 text-center">
        <span className="mx-auto inline-flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-teal text-night shadow-lg shadow-brand/30">
          <WifiOffIcon className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-ink">You&apos;re offline</h1>
        <p className="mt-3 text-muted-foreground">
          This page needs an internet connection. Check your connection and try again — nothing you were doing has
          been sent.
        </p>
        <div className="mt-8">
          <RetryButton />
        </div>
      </Container>
    </section>
  );
}
