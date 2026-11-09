import { CtaBand } from "@/components/marketing/cta-band";
import { PageHero } from "@/components/marketing/page-hero";
import { Section } from "@/components/marketing/section";
import { siteConfig } from "@/config/site";
import { pageMetadata } from "@/lib/seo";
import { photos } from "@/content/photos";

export const metadata = pageMetadata({
  title: "About",
  description:
    "CoreTech Recruiting is a Texas-based recruiting consultancy focused on IT infrastructure, networking, cybersecurity, cloud, and telecommunications talent.",
  path: "/about",
});

const values = [
  {
    title: "Specialization",
    body: "We focus on infrastructure and telecom disciplines so we can evaluate candidates in the terms hiring managers use.",
  },
  {
    title: "Respect for candidates",
    body: "Candidates decide where their information goes. We share profiles only for specific roles, and only with consent.",
  },
  {
    title: "Honest communication",
    body: "We tell employers and candidates what we know, what we don't, and what to expect next.",
  },
  {
    title: "People decide",
    body: "Tools help us stay organized, but recruiters and hiring managers make every hiring decision — never an algorithm.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        photo={photos.professionals}
        eyebrow="About us"
        title="A recruiting partner built around technical infrastructure"
        intro={`${siteConfig.name} connects employers with the network, security, cloud, telecom, and IT professionals who build and run critical infrastructure.`}
        breadcrumbs={[{ title: "About", href: "/about" }]}
      />

      <Section eyebrow="Our mission" title={siteConfig.tagline}>
        <div className="grid max-w-3xl gap-4 text-lg text-muted-foreground">
          <p>
            Technical hiring goes wrong when recruiters and hiring managers don&apos;t share a vocabulary. A network
            architect, a NOC engineer, and a wireless specialist are different hires — and the right candidate for one
            is rarely right for the others.
          </p>
          <p>
            We are a {siteConfig.location}-based consultancy that concentrates on these disciplines. Our work is direct-hire
            placement: understanding a role in depth, finding people with real experience in it, and supporting both
            sides through the hiring process.
          </p>
        </div>
      </Section>

      <Section tone="muted" eyebrow="What we value" title="How we work">
        <ul className="grid gap-5 sm:grid-cols-2">
          {values.map((value) => (
            <li key={value.title} className="rounded-xl border border-border bg-background p-6">
              <h3 className="text-lg font-semibold text-ink">{value.title}</h3>
              <p className="mt-2 text-muted-foreground">{value.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <CtaBand
        title="Work with CoreTech"
        body="Whether you're hiring or looking, we'd like to hear from you."
        primary={{ label: "Contact us", href: "/contact" }}
        secondary={{ label: "Our services", href: "/services" }}
      />
    </>
  );
}
