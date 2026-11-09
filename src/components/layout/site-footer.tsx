import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { Container } from "@/components/layout/container";
import { InstallAppButton } from "@/components/pwa/install-app-button";
import { footerNav, siteConfig } from "@/config/site";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative overflow-hidden bg-night text-white">
      <div aria-hidden="true" className="h-px bg-gradient-to-r from-transparent via-brand-400 to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/4 size-96 rounded-full bg-brand/30 blur-3xl" />
      <Container className="relative grid gap-10 py-14 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <Logo tone="dark" />
          <p className="max-w-xs text-sm text-white/75">{siteConfig.tagline}</p>
          <p className="text-sm text-white/70">{siteConfig.location}</p>
          <InstallAppButton className="mt-2 rounded-full border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" />
        </div>
        {footerNav.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h2 className="mb-3 text-sm font-semibold text-white">{group.title}</h2>
            <ul className="space-y-2">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-white/75 hover:text-teal-glow focus-visible:text-teal-glow focus-visible:outline-none"
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <div className="border-t border-night-700">
        <Container className="py-5 text-xs text-white/70">
          © {year} {siteConfig.name}. All rights reserved.
        </Container>
      </div>
    </footer>
  );
}
