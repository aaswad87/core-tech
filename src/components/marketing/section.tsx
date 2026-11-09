import { Container } from "@/components/layout/container";
import { cn } from "@/lib/utils";

type SectionProps = {
  id?: string;
  eyebrow?: string;
  title: string;
  intro?: string;
  tone?: "default" | "muted";
  align?: "left" | "center";
  className?: string;
  children?: React.ReactNode;
};

export function Section({ id, eyebrow, title, intro, tone = "default", align = "left", className, children }: SectionProps) {
  const headingId = id ? `${id}-heading` : undefined;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn("scroll-mt-16 py-20 sm:py-24", tone === "muted" && "bg-surface", className)}
    >
      <Container>
        <div className={cn("reveal max-w-2xl", align === "center" && "mx-auto text-center")}>
          {eyebrow && <p className="text-sm font-semibold tracking-wide text-brand uppercase">{eyebrow}</p>}
          <h2 id={headingId} className="mt-2 text-3xl font-bold tracking-tight text-balance text-ink sm:text-4xl">
            {title}
          </h2>
          {intro && <p className="mt-4 text-lg text-muted-foreground">{intro}</p>}
        </div>
        {children && <div className="mt-12">{children}</div>}
      </Container>
    </section>
  );
}
