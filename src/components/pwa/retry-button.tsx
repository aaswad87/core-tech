"use client";

import { RotateCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function RetryButton() {
  return (
    <Button size="lg" className="h-11 rounded-full px-6" onClick={() => window.location.reload()}>
      <RotateCwIcon aria-hidden="true" /> Try again
    </Button>
  );
}
