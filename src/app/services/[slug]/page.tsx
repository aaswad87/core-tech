import { notFound } from "next/navigation";

import { CheckList } from "@/components/marketing/check-list";
import { CtaBand } from "@/components/marketing/cta-band";
import { PageHero } from "@/components/marketing/page-hero";
import { Section } from "@/components/marketing/section";
import { SpecialtyGrid } from "@/components/marketing/specialty-grid";
import { getSpecialty, type SpecialtySlug, specialties } from "@/content/specialties";
import { pageMetadata } from "@/lib/seo";
import { specialtyPhotos } from "@/content/photos";

export const dynamicParams = false;

export function generateStaticParams() {
  return specialties.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: PageProps<"/services/[slug]">) {
  const specialty = getSpecialty((await params).slug);
  if (!specialty) return {};
  return pageMetadata({
    title: `${specialty.name} Recruiting`,
    description: `${specialty.summary} Direct-hire recruiting from CoreTech Recruiting, based in Texas.`,
    path: `/services/${specialty.slug}`,
  });
}

export default async function SpecialtyPage({ params }: PageProps<"/services/[slug]">) {
  const specialty = getSpecialty((await params).slug);
  if (!specialty) notFound();

  const candidateSpecialty: SpecialtySlug = specialty.slug;

  return (
    <>
      <PageHero
        photo={specialtyPhotos[specialty.slug]}
        eyebrow={`${specialty.name} recruiting`}
        title={specialty.headline}
        intro={specialty.intro}
        breadcrumbs={[
          { title: "Services", href: "/services" },
          { title: specialty.name, href: `/services/${specialty.slug}` },
        ]}
      />

      <Section eyebrow="Roles" title={`${specialty.name} roles we recruit for`}>
        <div className="grid gap-10 lg:grid-cols-2">
          <CheckList items={specialty.roles} />
          <div className="rounded-xl border border-border bg-surface p-6">
            <h3 className="text-lg font-semibold text-ink">Skills and experience we screen for</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Typical examples — every search is defined by your role&apos;s actual requirements.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {specialty.skills.map((skill) => (
                <li key={skill} className="rounded-full border border-border bg-background px-3 py-1 text-sm text-foreground">
                  {skill}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section tone="muted" eyebrow="Our approach" title={`How we approach ${specialty.name.toLowerCase()} searches`}>
        <ul className="grid gap-5 md:grid-cols-3">
          {specialty.focusAreas.map((area) => (
            <li key={area.title} className="rounded-xl border border-border bg-background p-6">
              <h3 className="text-lg font-semibold text-ink">{area.title}</h3>
              <p className="mt-2 text-muted-foreground">{area.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <CtaBand
        title={`Hiring for ${specialty.name.toLowerCase()}, or working in it?`}
        body="Employers can submit a hiring request. Professionals can browse open jobs or tell us what they're looking for."
        primary={{ label: "Submit a hiring request", href: "/employers#hiring-request" }}
        secondary={{ label: "I'm a candidate", href: `/candidates?specialty=${candidateSpecialty}#talk-to-a-recruiter` }}
      />

      <Section eyebrow="More specialties" title="Other areas we recruit">
        <SpecialtyGrid exclude={specialty.slug} />
      </Section>
    </>
  );
}
