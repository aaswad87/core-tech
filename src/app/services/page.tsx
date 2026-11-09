import { CtaBand } from "@/components/marketing/cta-band";
import { PageHero } from "@/components/marketing/page-hero";
import { ProcessSteps } from "@/components/marketing/process-steps";
import { Section } from "@/components/marketing/section";
import { SpecialtyGrid } from "@/components/marketing/specialty-grid";
import { pageMetadata } from "@/lib/seo";
import { photos } from "@/content/photos";

export const metadata = pageMetadata({
  title: "Services",
  description:
    "Direct-hire recruiting for IT infrastructure, networking, cybersecurity, cloud, and telecommunications roles from a Texas-based recruiting consultancy.",
  path: "/services",
});

const searchSteps = [
  { title: "Intake", body: "A working session with the hiring manager to define responsibilities, must-have skills, and the interview plan." },
  { title: "Sourcing", body: "Targeted outreach to active and passive candidates with relevant, hands-on experience." },
  { title: "Screening", body: "Recruiter conversations focused on job-related skills, experience, and fit with the role's requirements." },
  { title: "Submission and support", body: "Consent-based submissions, interview coordination, feedback, and offer support through the start date." },
];

export default function ServicesPage() {
  return (
    <>
      <PageHero
        photo={photos.teamLaptop}
        eyebrow="Services"
        title="Direct-hire recruiting for technical infrastructure roles"
        intro="We specialize in the disciplines that keep businesses connected and secure. Direct-hire placement is our core service."
        breadcrumbs={[{ title: "Services", href: "/services" }]}
      />

      <Section eyebrow="Specialties" title="Where we recruit">
        <SpecialtyGrid />
      </Section>

      <Section tone="muted" eyebrow="How a search works" title="A clear process from intake to start date">
        <ProcessSteps steps={searchSteps} />
      </Section>

      <Section
        eyebrow="Engagement"
        title="Direct hire first"
        intro="Our current focus is permanent, direct-hire placement. If you're also considering contract or contract-to-hire arrangements, tell us about it — we'll be clear about what we can support today."
      />

      <CtaBand
        title="Have a role to fill?"
        body="Share the details and a recruiter will follow up to plan the search."
        primary={{ label: "Submit a hiring request", href: "/employers#hiring-request" }}
        secondary={{ label: "Contact us", href: "/contact" }}
      />
    </>
  );
}
