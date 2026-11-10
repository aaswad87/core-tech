import Link from "next/link";

import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** "dark" renders light text for dark backgrounds. */
  tone?: "light" | "dark";
};

export function LogoMark({ className }: { className?: string }) {
  return (
    // Hex chip with a connected "CT": the C's top stroke runs into the T's bar, and the T ends in a glowing node.
    // Keep in sync with src/app/icon.svg, scripts/generate-icons.mjs and src/app/opengraph-image.tsx.
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-9 shrink-0", className)}>
      <defs>
        <linearGradient id="ct-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#a3e635" />
        </linearGradient>
        <linearGradient id="ct-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#15231d" />
          <stop offset="1" stopColor="#050807" />
        </linearGradient>
        <filter id="ct-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d="M32 5 L55.4 18.5 L55.4 45.5 L32 59 L8.6 45.5 L8.6 18.5 Z"
        fill="url(#ct-fill)"
        stroke="url(#ct-rim)"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path d="M48.5 24.2 H34.8 A11 11 0 1 0 32.5 41.5" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M42 24.2 V37" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="42" cy="41.5" r="3.6" fill="#bef264" filter="url(#ct-glow)" />
    </svg>
  );
}

export function Logo({ className, tone = "light" }: LogoProps) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-2.5 rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      <LogoMark />
      <span
        className={cn(
          "text-lg font-semibold tracking-tight",
          tone === "dark" ? "text-white" : "text-ink",
        )}
      >
        CoreTech <span className={cn("font-normal", tone === "dark" ? "text-brand-400" : "text-brand")}>Recruiting</span>
        <span className="sr-only"> — {siteConfig.tagline}</span>
      </span>
    </Link>
  );
}
