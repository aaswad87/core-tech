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
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id="ct-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#059669" />
          <stop offset="1" stopColor="#65a30d" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#ct-mark)" />
      <path d="M21.5 10.5a8 8 0 1 0 0 11" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.75" fill="#bef264" />
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
