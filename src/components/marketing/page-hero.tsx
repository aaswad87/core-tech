import { Container } from "@/components/layout/container";
import { Breadcrumbs, type Crumb } from "@/components/marketing/breadcrumbs";
import { Spotlight, Tilt } from "@/components/marketing/effects";
import { GradientMesh } from "@/components/marketing/gradient-mesh";
import { PhotoFill } from "@/components/marketing/photo";
import type { Photo } from "@/content/photos";
import { cn } from "@/lib/utils";

type PageHeroProps = {
  eyebrow?: string;
  title: string;
  intro?: string;
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
  /** Optional illustrative photo shown in a floating card beside the text on large screens. */
  photo?: Photo;
};

/** Dark page header (black + emerald) used by the public content pages. */
export function PageHero({ eyebrow, title, intro, breadcrumbs, actions, photo }: PageHeroProps) {
  return (
    <section className="relative overflow-hidden bg-night text-white">
      <GradientMesh tone="dark" />
      <Spotlight />
      <Container className={cn("relative grid items-center gap-10 py-14 sm:py-20", photo && "lg:grid-cols-[1.2fr_1fr]")}>
        <div>
          {breadcrumbs && <Breadcrumbs items={breadcrumbs} tone="dark" />}
          {eyebrow && (
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-white/5 px-3 py-1 text-xs font-semibold tracking-wide text-brand-400 uppercase backdrop-blur">
              <span className="size-1.5 rounded-full bg-teal" aria-hidden="true" />
              {eyebrow}
            </p>
          )}
          <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl">{title}</h1>
          {intro && <p className="mt-5 max-w-2xl text-lg text-white/70">{intro}</p>}
          {actions && <div className="mt-8 flex flex-wrap gap-3">{actions}</div>}
        </div>
        {photo && (
          <Tilt className="relative hidden aspect-[4/3] lg:block">
            <div
              className="animate-float-slow shine absolute inset-0 overflow-hidden rounded-[2rem] shadow-[0_24px_70px_rgb(16_185_129/0.28)] ring-1 ring-white/15"
              style={{ ["--tilt" as string]: "2deg" }}
            >
              <PhotoFill photo={photo} sizes="(min-width: 1024px) 40vw, 0px" priority className="parallax" />
              <div className="absolute inset-0 bg-gradient-to-tr from-night/50 via-transparent to-brand-500/25" />
            </div>
          </Tilt>
        )}
      </Container>
    </section>
  );
}
