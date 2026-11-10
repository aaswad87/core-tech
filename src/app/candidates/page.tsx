import Link from "next/link";

import { LeadFormSection } from "@/components/leads/lead-form-section";
import { CheckList } from "@/components/marketing/check-list";
import { PageHero } from "@/components/marketing/page-hero";
import { ProcessSteps } from "@/components/marketing/process-steps";
import { Section } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { SPECIALTY_VALUES } from "@/content/specialties";
import { isSupabaseConfigured } from "@/lib/env";
import { pageMetadata } from "@/lib/seo";
import { photos } from "@/content/photos";

export const metadata = pageMetadata({
  title: "For Candidates",
  description:
    "Find network, cybersecurity, cloud, telecom, and IT infrastructure jobs with CoreTech Recruiting. Your profile is shared only with your consent.",
  path: "/candidates",
});

const commitments = [
  "We share your profile with an employer only for a specific role, and only after you agree",
  "We never charge candidates a fee",
  "We'll tell you who the employer is before you interview",
  "You can ask us to update or delete your information at any time",
];

const steps = [
  { title: "Get in touch", body: "Apply to an open role, or tell us what you're looking for using the form below." },
  { title: "Talk with a recruiter", body: "We learn about your experience, goals, and what matters to you in your next role." },
  { title: "Review opportunities", body: "We describe matching roles. You decide which ones you want to be considered for." },
  { title: "Interview and offer", body: "We prepare you for interviews, share feedback, and help with the offer." },
];

export default async function CandidatesPage({ searchParams }: PageProps<"/candidates">) {
  const { specialty } = await searchParams;
  const defaultSpecialty =
    typeof specialty === "string" && SPECIALTY_VALUES.includes(specialty) ? specialty : undefined;

  return (
    <>
      <PageHero
        photo={photos.engineerDesk}
        eyebrow="For candidates"
        title="Find your next infrastructure role"
        intro="We work with network, security, cloud, telecom, and IT professionals at every stage of their careers."
        breadcrumbs={[{ title: "Candidates", href: "/candidates" }]}
        actions={
          <>
            <Button asChild size="lg" className="h-11 rounded-full bg-gradient-to-r from-brand-400 to-teal font-semibold text-night px-5 shadow-[0_0_24px_rgb(16_185_129/0.4)] hover:opacity-95">
              <Link href="/jobs">Browse open jobs</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 rounded-full border-white/20 bg-white/5 px-5 text-white backdrop-blur hover:border-brand-400/60 hover:bg-white/10 hover:text-white"
            >
              <Link href="#talk-to-a-recruiter">Talk to a recruiter</Link>
            </Button>
          </>
        }
      />

      <Section eyebrow="Our commitments" title="Your career, your information, your decision">
        <CheckList items={commitments} className="max-w-2xl" />
      </Section>

      <Section tone="muted" eyebrow="Process" title="What to expect">
        <ProcessSteps steps={steps} />
      </Section>

      {isSupabaseConfigured() && (
        <Section
          eyebrow="Candidate account"
          title="Create a free candidate account"
          intro="An account lets you keep your details in one place. More candidate tools are on the way."
        >
          <Button asChild size="lg" className="h-11 rounded-full bg-gradient-to-r from-brand-400 to-teal font-semibold text-night px-5 shadow-[0_0_24px_rgb(16_185_129/0.4)] hover:opacity-95">
            <Link href="/signup">Create an account</Link>
          </Button>
        </Section>
      )}

      <Section
        id="talk-to-a-recruiter"
        tone="muted"
        eyebrow="Talk to a recruiter"
        title="Tell us what you're looking for"
        intro="No resume needed yet. A recruiter will reach out by email if there's a good match."
      >
        <div className="max-w-3xl rounded-xl border border-border bg-background p-6 sm:p-8">
          <LeadFormSection
            type="candidate"
            sourcePath="/candidates"
            submitLabel="Send to a recruiter"
            defaults={{ specialty: defaultSpecialty }}
          />
        </div>
      </Section>
    </>
  );
}
