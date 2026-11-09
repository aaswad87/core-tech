import { BriefcaseIcon, MapPinIcon, UserSearchIcon } from "lucide-react";
import Link from "next/link";

import { LeadFormSection } from "@/components/leads/lead-form-section";
import { Container } from "@/components/layout/container";
import { PageHero } from "@/components/marketing/page-hero";
import { siteConfig } from "@/config/site";
import { pageMetadata } from "@/lib/seo";
import { CONTACT_TOPICS } from "@/lib/validation/leads";
import { photos } from "@/content/photos";

export const metadata = pageMetadata({
  title: "Contact",
  description: "Contact CoreTech Recruiting about hiring technical talent, finding your next role, or anything else.",
  path: "/contact",
});

export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const { topic } = await searchParams;
  const defaultTopic = CONTACT_TOPICS.some((t) => t.value === topic) ? (topic as string) : undefined;

  return (
    <>
      <PageHero
        photo={photos.handshakeWomen}
        eyebrow="Contact"
        title="Get in touch"
        intro="Send us a message and a member of our team will reply by email."
        breadcrumbs={[{ title: "Contact", href: "/contact" }]}
      />

      <Container className="grid gap-10 py-16 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="contact-form-heading" className="rounded-xl border border-border bg-background p-6 sm:p-8">
          <h2 id="contact-form-heading" className="mb-6 text-2xl font-semibold tracking-tight text-ink">
            Send a message
          </h2>
          <LeadFormSection type="contact" sourcePath="/contact" submitLabel="Send message" defaults={{ topic: defaultTopic }} />
        </section>

        <aside className="grid content-start gap-6">
          <div className="rounded-xl bg-surface p-6">
            <BriefcaseIcon className="size-6 text-brand" aria-hidden="true" />
            <h2 className="mt-3 font-semibold text-ink">Hiring?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The hiring request form asks for the details we need to get started.
            </p>
            <Link href="/employers#hiring-request" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
              Submit a hiring request
            </Link>
          </div>
          <div className="rounded-xl bg-surface p-6">
            <UserSearchIcon className="size-6 text-brand" aria-hidden="true" />
            <h2 className="mt-3 font-semibold text-ink">Looking for a job?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Browse open roles or tell a recruiter what you&apos;re looking for.</p>
            <Link href="/jobs" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
              View open jobs
            </Link>
          </div>
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <MapPinIcon className="size-4" aria-hidden="true" />
            Based in {siteConfig.location}
          </div>
        </aside>
      </Container>
    </>
  );
}
