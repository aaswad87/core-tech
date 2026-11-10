import { ArrowRightIcon, CheckIcon, LockIcon, NetworkIcon, ShieldCheckIcon, UserCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { CtaBand } from "@/components/marketing/cta-band";
import { Spotlight, Tilt } from "@/components/marketing/effects";
import { GradientMesh } from "@/components/marketing/gradient-mesh";
import { JsonLd } from "@/components/marketing/json-ld";
import { Marquee } from "@/components/marketing/marquee";
import { PhotoFill } from "@/components/marketing/photo";
import { RotatingWord } from "@/components/marketing/rotating-word";
import { Section } from "@/components/marketing/section";
import { SpecialtyGrid } from "@/components/marketing/specialty-grid";
import { Button } from "@/components/ui/button";
import { photos } from "@/content/photos";
import { siteConfig } from "@/config/site";
import { absoluteUrl } from "@/lib/seo";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const ROLES = ["network engineers", "security analysts", "cloud architects", "RF engineers", "IT leaders"] as const;

const SKILLS = [
  "BGP & OSPF", "SD-WAN", "Firewalls", "SIEM & SOAR", "Zero trust", "AWS", "Azure", "Kubernetes",
  "Terraform", "5G RAN", "DWDM", "Fiber & OSP", "VoIP & UC", "Active Directory", "VMware", "Python automation",
] as const;

const PROMISES = ["Direct-hire placement", "Consent-based submissions", "People make every hiring decision"] as const;

const approachSteps = [
  { title: "Understand the role", body: "We define must-have and preferred skills with the hiring team before sourcing." },
  { title: "Evaluate on evidence", body: "Candidates are assessed on job-related skills and experience, reviewed by a person." },
  { title: "Submit with consent", body: "Profiles are presented to employers only with the candidate's agreement." },
  { title: "Support through hire", body: "We coordinate interviews, feedback, and offers through to start date." },
];

function GlassChip({ icon: Icon, children, className }: { icon: typeof LockIcon; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`absolute z-20 flex items-center gap-2.5 rounded-2xl border border-white/15 bg-night/75 px-3.5 py-2.5 text-sm font-medium text-white shadow-[0_10px_40px_rgb(0_0_0/0.45)] backdrop-blur-md ${className ?? ""}`}
    >
      <span className="inline-flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-teal text-night">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      {children}
    </div>
  );
}

function HeroCollage() {
  return (
    <div className="relative mx-auto h-[24rem] w-full max-w-xl sm:h-[30rem] lg:h-[34rem]" aria-label="Recruiting photography" role="group">
      <div
        className="animate-float shine absolute top-0 right-0 h-[62%] w-[66%] overflow-hidden rounded-[2rem] shadow-[0_24px_70px_rgb(16_185_129/0.28)] ring-1 ring-white/15"
        style={{ ["--tilt" as string]: "3deg" }}
      >
        <PhotoFill photo={photos.interview} sizes="(min-width: 1024px) 26vw, 66vw" priority className="parallax" />
      </div>
      <div
        className="animate-float-slow shine absolute bottom-0 left-0 h-[56%] w-[60%] overflow-hidden rounded-[2rem] shadow-[0_24px_70px_rgb(132_204_22/0.22)] ring-1 ring-white/15"
        style={{ ["--tilt" as string]: "-4deg", animationDelay: "-3s" }}
      >
        <PhotoFill photo={photos.handshakeWomen} sizes="(min-width: 1024px) 24vw, 60vw" priority className="parallax" />
      </div>
      <div
        className="animate-float absolute top-[8%] left-[4%] hidden h-[30%] w-[34%] overflow-hidden rounded-3xl shadow-xl ring-1 ring-white/20 sm:block"
        style={{ ["--tilt" as string]: "-6deg", animationDelay: "-5s" }}
      >
        <PhotoFill photo={photos.engineerMonitors} sizes="(min-width: 1024px) 14vw, 34vw" />
      </div>
      <div
        className="animate-float-slow absolute right-[2%] bottom-[6%] hidden h-[30%] w-[32%] overflow-hidden rounded-3xl shadow-xl ring-1 ring-white/20 sm:block"
        style={{ ["--tilt" as string]: "5deg", animationDelay: "-1.5s" }}
      >
        <PhotoFill photo={photos.serverTechnician} sizes="(min-width: 1024px) 13vw, 32vw" />
      </div>

      <GlassChip icon={NetworkIcon} className="top-[40%] -left-2 sm:-left-6">
        Networking · Security · Cloud · Telecom
      </GlassChip>
      <GlassChip icon={LockIcon} className="right-[4%] bottom-[38%] sm:right-[-1rem]">
        Shared only with consent
      </GlassChip>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "EmploymentAgency",
          name: siteConfig.name,
          slogan: siteConfig.tagline,
          description: siteConfig.description,
          url: absoluteUrl("/"),
          logo: absoluteUrl("/icon.svg"),
          areaServed: "US",
          address: { "@type": "PostalAddress", addressRegion: "TX", addressCountry: "US" },
        }}
      />

      {/* Hero */}
      <section className="relative overflow-hidden bg-night text-white">
        <GradientMesh tone="dark" />
        <Spotlight />
        <Container className="relative grid items-center gap-12 pt-14 pb-10 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:pt-24 lg:pb-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-white/5 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-brand-400 uppercase backdrop-blur">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-teal opacity-60" aria-hidden="true" />
                <span className="relative inline-flex size-2 rounded-full bg-teal" />
              </span>
              IT &amp; Telecom Recruiting · {siteConfig.location}
            </p>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl xl:text-6xl">
              Connecting <span className="text-gradient">Technical Talent.</span> Powering Business.
            </h1>
            <p className="mt-6 text-xl text-white/90 sm:text-2xl">
              Direct-hire recruiting for{" "}
              <span className="font-semibold text-brand-400">
                <RotatingWord words={ROLES} />
              </span>
            </p>
            <p className="mt-4 max-w-xl text-lg text-white/65">{siteConfig.description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full bg-gradient-to-r from-brand-400 to-teal px-6 text-base font-semibold text-night shadow-[0_0_30px_rgb(16_185_129/0.45)] transition-all hover:-translate-y-0.5 hover:shadow-[0_0_44px_rgb(163_230_53/0.6)]"
              >
                <Link href="/employers">
                  Hire talent <ArrowRightIcon aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-white/20 bg-white/5 px-6 text-base text-white backdrop-blur hover:border-brand-400/60 hover:bg-white/10 hover:text-white">
                <Link href="/jobs">Browse open jobs</Link>
              </Button>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/65">
              {PROMISES.map((p) => (
                <li key={p} className="flex items-center gap-1.5">
                  <CheckIcon className="size-4 text-teal" aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <Tilt max={5}>
            <HeroCollage />
          </Tilt>
        </Container>

        <div className="relative pb-14">
          <Marquee items={SKILLS} label="Skills we recruit for" tone="dark" />
        </div>
      </section>

      <Section
        id="specialties"
        tone="muted"
        eyebrow="Specialties"
        title="Technical recruiting, focused where we know the work"
        intro="We concentrate on infrastructure disciplines so we speak the same language as the engineers and hiring managers we work with."
      >
        <SpecialtyGrid />
      </Section>

      {/* Two audiences */}
      <Section eyebrow="How we help" title="One team, both sides of every placement" align="center">
        <div className="grid gap-6 md:grid-cols-2">
          {[
            {
              href: "/employers",
              photo: photos.handshakeTable,
              icon: UserCheckIcon,
              kicker: "For employers",
              title: "Hire engineers who've done the work",
              body: "Focused direct-hire searches, screened against the skills your role actually requires.",
              cta: "Hire with CoreTech",
            },
            {
              href: "/candidates",
              photo: photos.engineerDesk,
              icon: ShieldCheckIcon,
              kicker: "For candidates",
              title: "Your next role, on your terms",
              body: "Recruiters who understand infrastructure careers — and share your profile only with your consent.",
              cta: "Explore opportunities",
            },
          ].map(({ href, photo, icon: Icon, kicker, title, body, cta }) => (
            <Link
              key={href}
              href={href}
              className="reveal shine group relative isolate flex min-h-[26rem] flex-col justify-end overflow-hidden rounded-[2rem] p-8 text-white shadow-xl shadow-brand/15 transition-shadow duration-500 hover:shadow-[0_30px_80px_rgb(16_185_129/0.35)] focus-visible:ring-4 focus-visible:ring-ring/60 focus-visible:outline-none"
            >
              <PhotoFill photo={photo} sizes="(min-width: 768px) 50vw, 100vw" className="-z-20 saturate-[0.85] transition-all duration-700 ease-out group-hover:scale-110 group-hover:saturate-100" />
              <div className="absolute inset-0 -z-10 bg-gradient-to-t from-night via-night/60 to-transparent" />
              <div className="absolute inset-0 -z-10 bg-gradient-to-br from-brand-500/45 via-transparent to-teal/35 opacity-0 mix-blend-overlay transition-opacity duration-500 group-hover:opacity-100" />
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide uppercase ring-1 ring-white/30 backdrop-blur">
                <Icon className="size-3.5" aria-hidden="true" /> {kicker}
              </span>
              <h3 className="mt-4 text-2xl font-bold sm:text-3xl">{title}</h3>
              <p className="mt-2 max-w-md text-white/85">{body}</p>
              <span className="mt-6 inline-flex items-center gap-1.5 font-semibold">
                {cta}
                <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </Section>

      {/* Approach */}
      <section aria-labelledby="approach-heading" className="relative overflow-hidden bg-surface py-20 sm:py-24">
        <Container className="grid items-center gap-14 lg:grid-cols-2">
          <div className="reveal relative mx-auto aspect-[4/5] w-full max-w-md">
            <div className="absolute inset-0 overflow-hidden rounded-[2rem] shadow-2xl shadow-brand/20">
              <PhotoFill photo={photos.presenter} sizes="(min-width: 1024px) 40vw, 90vw" className="parallax object-[72%_50%]" />
              <div className="absolute inset-0 bg-gradient-to-tr from-brand/25 to-transparent" />
            </div>
            <div className="absolute -right-4 -bottom-6 w-56 overflow-hidden rounded-3xl shadow-xl ring-4 ring-white sm:-right-10">
              <div className="relative aspect-[4/3]">
                <PhotoFill photo={photos.boardMeeting} sizes="224px" />
              </div>
            </div>
          </div>
          <div>
            <div className="reveal">
              <p className="text-sm font-semibold tracking-wide text-brand uppercase">Our approach</p>
              <h2 id="approach-heading" className="mt-2 text-3xl font-bold tracking-tight text-balance text-ink sm:text-4xl">
                Technology keeps us organized. <span className="text-gradient-deep">People make the decisions.</span>
              </h2>
            </div>
            <ol className="mt-10 grid gap-6">
              {approachSteps.map((step, i) => (
                <li key={step.title} className="reveal flex gap-5">
                  <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-teal text-lg font-bold text-night shadow-[0_0_20px_rgb(16_185_129/0.35)]">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold text-ink">{step.title}</h3>
                    <p className="mt-1 text-muted-foreground">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </section>

      <CtaBand
        title="Let's talk about your next hire — or your next role"
        body="Tell us what you need and a recruiter will follow up by email."
        primary={{ label: "Contact us", href: "/contact" }}
        secondary={{ label: "View open jobs", href: "/jobs" }}
      />
    </>
  );
}
