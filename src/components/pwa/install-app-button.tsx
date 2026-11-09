"use client";

import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * "Install app" button. Renders only when the browser has actually offered installation
 * (Chrome/Edge on Android and desktop), so it is never a dead control. Browsers without the
 * install event (e.g. iOS Safari) simply don't show it.
 */
export function InstallAppButton({ className }: { className?: string }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setPromptEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!promptEvent) return null;

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={async () => {
        await promptEvent.prompt();
        await promptEvent.userChoice;
        // The event can only be used once.
        setPromptEvent(null);
      }}
    >
      <DownloadIcon aria-hidden="true" /> Install the app
    </Button>
  );
}
