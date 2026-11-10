import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { PhotoFill } from "@/components/marketing/photo";
import { Button } from "@/components/ui/button";
import { photos } from "@/content/photos";

type CtaBandProps = {
  title: string;
  body: string;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
};

export function CtaBand({ title, body, primary, secondary }: CtaBandProps) {
  return (
    <section className="px-4 py-16 sm:px-6 lg:px-8">
      <Container className="reveal glow-border relative overflow-hidden rounded-[2rem] bg-night px-6 py-14 text-white shadow-[0_30px_90px_rgb(16_185_129/0.25)] sm:px-12">
        <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden rounded-[2rem]">
          <PhotoFill photo={photos.handshakeTable} sizes="(min-width: 1280px) 1152px, 100vw" className="parallax opacity-25 mix-blend-luminosity" />
          <div className="absolute inset-0 bg-gradient-to-r from-night via-night/85 to-brand-700/40" />
          <div className="absolute -top-24 -right-24 size-72 rounded-full bg-brand-500/30 blur-3xl" />
          <div className="absolute -bottom-28 left-1/3 size-72 rounded-full bg-teal/20 blur-3xl" />
        </div>
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{title}</h2>
            <p className="mt-3 text-lg text-white/75">{body}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-full bg-gradient-to-r from-brand-400 to-teal px-6 text-base font-semibold text-night shadow-[0_0_30px_rgb(16_185_129/0.45)] transition-all hover:-translate-y-0.5 hover:shadow-[0_0_44px_rgb(163_230_53/0.6)]"
            >
              <Link href={primary.href}>
                {primary.label} <ArrowRightIcon aria-hidden="true" />
              </Link>
            </Button>
            {secondary && (
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-white/20 bg-white/5 px-6 text-base text-white backdrop-blur hover:border-brand-400/60 hover:bg-white/10 hover:text-white"
              >
                <Link href={secondary.href}>{secondary.label}</Link>
              </Button>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
