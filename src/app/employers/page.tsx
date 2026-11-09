import { CheckList } from "@/components/marketing/check-list";
import { PageHero } from "@/components/marketing/page-hero";
import { ProcessSteps } from "@/components/marketing/process-steps";
import { Section } from "@/components/marketing/section";
import { SpecialtyGrid } from "@/components/marketing/specialty-grid";
import { LeadFormSection } from "@/components/leads/lead-form-section";
import { Button } from "@/components/ui/button";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { photos } from "@/content/photos";

export const metadata = pageMetadata({
  title: "For Employers",
  description:
    "Direct-hire recruiting for network, cybersecurity, cloud, telecom, and IT infrastructure roles. Submit a hiring request to CoreTech Recruiting.",
  path: "/employers",
});

const benefits = [
  "Recruiters who specialize in infrastructure and telecom roles",
  "Candidates screened against your role's stated requirements",
  "Consent-based submissions — candidates know they're being presented to you",
  "A shortlist you can review, not a stack of unscreened resumes",
  "Interview coordination and feedback through to offer",
];

const steps = [
  { title: "Tell us about the role", body: "Submit a hiring request below. We'll schedule a call to go deeper on responsibilities and requirements." },
  { title: "Agree on the search", body: "We confirm scope, timeline, and terms in writing before we begin." },
  { title: "Review candidates", body: "We present screened candidates with a summary of how their experience maps to your requirements." },
  { title: "Interview and hire", body: "We coordinate interviews, gather feedback, and support the offer process." },
];

export default function EmployersPage() {
  return (
    <>
      <PageHero
        photo={photos.handshakeTable}
        eyebrow="For employers"
        title="Hire infrastructure talent with a recruiter who knows the work"
        intro="Direct-hire recruiting for network, security, cloud, telecom, and IT infrastructure teams."
        breadcrumbs={[{ title: "Employers", href: "/employers" }]}
        actions={
          <Button asChild size="lg" className="h-11 rounded-full bg-gradient-to-r from-brand to-teal px-5 shadow-lg shadow-brand/25 hover:opacity-95">
            <Link href="#hiring-request">Submit a hiring request</Link>
          </Button>
        }
      />

      <Section eyebrow="Why CoreTech" title="Focused searches, screened on what matters">
        <CheckList items={benefits} className="max-w-2xl" />
      </Section>

      <Section tone="muted" eyebrow="Process" title="How working with us works">
        <ProcessSteps steps={steps} />
      </Section>

      <Section eyebrow="Specialties" title="Roles we recruit for">
        <SpecialtyGrid />
      </Section>

      <Section
        id="hiring-request"
        tone="muted"
        eyebrow="Get started"
        title="Submit a hiring request"
        intro="Share the basics. A recruiter will follow up by email to discuss the role — submitting this form doesn't commit you to anything."
      >
        <div className="max-w-3xl rounded-xl border border-border bg-background p-6 sm:p-8">
          <LeadFormSection type="employer" sourcePath="/employers" submitLabel="Send hiring request" />
        </div>
      </Section>
    </>
  );
}
