import { Container } from "@/components/layout/container";
import { Breadcrumbs, type Crumb } from "@/components/marketing/breadcrumbs";
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

export function PageHero({ eyebrow, title, intro, breadcrumbs, actions, photo }: PageHeroProps) {
  return (
    <section className="relative overflow-hidden bg-white">
      <GradientMesh />
      <Container className={cn("relative grid items-center gap-10 py-14 sm:py-20", photo && "lg:grid-cols-[1.2fr_1fr]")}>
        <div>
          {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
          {eyebrow && (
            <p className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-white/70 px-3 py-1 text-xs font-semibold tracking-wide text-brand uppercase backdrop-blur">
              <span className="size-1.5 rounded-full bg-teal" aria-hidden="true" />
              {eyebrow}
            </p>
          )}
          <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-tight text-balance text-ink sm:text-5xl">{title}</h1>
          {intro && <p className="mt-5 max-w-2xl text-lg text-muted-foreground">{intro}</p>}
          {actions && <div className="mt-8 flex flex-wrap gap-3">{actions}</div>}
        </div>
        {photo && (
          <div className="relative hidden aspect-[4/3] lg:block">
            <div
              className="animate-float-slow absolute inset-0 overflow-hidden rounded-[2rem] shadow-2xl ring-1 shadow-brand/20 ring-white/60"
              style={{ ["--tilt" as string]: "2deg" }}
            >
              <PhotoFill photo={photo} sizes="(min-width: 1024px) 40vw, 0px" priority />
              <div className="absolute inset-0 bg-gradient-to-tr from-brand/30 via-transparent to-teal/20 mix-blend-multiply" />
            </div>
          </div>
        )}
      </Container>
    </section>
  );
}
