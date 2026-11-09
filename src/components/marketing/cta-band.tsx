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
      <Container className="reveal relative isolate overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-700 via-brand to-teal px-6 py-14 text-white shadow-2xl shadow-brand/25 sm:px-12">
        <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-20 mix-blend-luminosity">
          <PhotoFill photo={photos.handshakeTable} sizes="(min-width: 1280px) 1152px, 100vw" />
        </div>
        <div aria-hidden="true" className="absolute -top-24 -right-24 -z-10 size-72 rounded-full bg-teal-glow/40 blur-3xl" />
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{title}</h2>
            <p className="mt-3 text-lg text-white/90">{body}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-12 rounded-full bg-white px-6 text-base text-brand-700 shadow-lg hover:bg-brand-50">
              <Link href={primary.href}>
                {primary.label} <ArrowRightIcon aria-hidden="true" />
              </Link>
            </Button>
            {secondary && (
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-white/60 bg-white/10 px-6 text-base text-white backdrop-blur hover:bg-white/20 hover:text-white"
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
