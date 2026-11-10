import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { Container } from "@/components/layout/container";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NavLink } from "@/components/layout/nav-link";
import { Button } from "@/components/ui/button";
import { mainNav, type NavItem } from "@/config/site";
import { getSessionUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";

/** The account entry point, or null when auth is not configured (so no dead "Sign in" link is shown). */
async function getAccountItem(): Promise<NavItem | null> {
  if (!isSupabaseConfigured()) return null;
  const user = await getSessionUser();
  return user ? { title: "Your account", href: "/account" } : { title: "Sign in", href: "/login" };
}

export async function SiteHeader() {
  const accountItem = await getAccountItem();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-night/85 text-white shadow-[0_1px_0_rgb(16_185_129/0.15)] backdrop-blur-xl supports-backdrop-filter:bg-night/70">
      <Container className="flex h-16 items-center justify-between gap-6">
        <Logo tone="dark" />
        <div className="flex items-center gap-2">
          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {mainNav.map((item) => (
                <li key={item.href}>
                  <NavLink
                    href={item.href}
                    className="rounded-full px-3.5 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    activeClassName="bg-brand-500/15 text-brand-400"
                  >
                    {item.title}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          {accountItem && (
            <Button asChild variant="ghost" className="hidden h-9 rounded-full px-3.5 text-white/85 hover:bg-white/10 hover:text-white lg:inline-flex">
              <Link href={accountItem.href}>{accountItem.title}</Link>
            </Button>
          )}
          <Button
            asChild
            className="hidden h-9 rounded-full bg-gradient-to-r from-brand-400 to-teal px-4 font-semibold text-night shadow-[0_0_24px_rgb(16_185_129/0.45)] transition-shadow hover:opacity-95 hover:shadow-[0_0_32px_rgb(163_230_53/0.55)] sm:inline-flex"
          >
            <Link href="/employers#hiring-request">Hire talent</Link>
          </Button>
          <MobileNav items={accountItem ? [...mainNav, accountItem] : mainNav} />
        </div>
      </Container>
    </header>
  );
}
