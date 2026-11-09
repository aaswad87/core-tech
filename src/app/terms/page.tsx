import Link from "next/link";

import { LegalPage } from "@/components/marketing/legal-page";
import { siteConfig } from "@/config/site";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Terms of Use",
  description: `The terms that apply to your use of the ${siteConfig.name} website.`,
  path: "/terms",
});

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" path="/terms" lastUpdated="October 30, 2026">
      <section>
        <p>
          These terms apply to your use of the {siteConfig.name} website. By using the site, you agree to them. If you do
          not agree, please do not use the site.
        </p>
      </section>

      <section>
        <h2>Our services</h2>
        <p>
          The site describes our recruiting services and lets employers and candidates contact us. Submitting a form,
          applying for a role, or creating an account does not guarantee employment, an interview, a placement, or any
          particular result. Separate written agreements govern recruiting engagements with employers.
        </p>
      </section>

      <section>
        <h2>Job listings</h2>
        <p>
          We try to keep job listings accurate and current, but roles may be filled, changed, or withdrawn at any time.
          Listings are not offers of employment.
        </p>
      </section>

      <section>
        <h2>Accounts</h2>
        <ul>
          <li>Provide accurate information and keep your password confidential.</li>
          <li>You are responsible for activity under your account. Tell us promptly if you suspect unauthorized use.</li>
          <li>We may suspend or close accounts that violate these terms.</li>
        </ul>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>submit false, misleading, or someone else&apos;s information;</li>
          <li>attempt to access data or areas of the site you are not authorized to access;</li>
          <li>interfere with the site&apos;s operation, or send spam or automated submissions;</li>
          <li>copy or scrape site content or job listings for commercial use without permission.</li>
        </ul>
      </section>

      <section>
        <h2>Intellectual property</h2>
        <p>
          The site&apos;s content, design, and branding belong to {siteConfig.name} or its licensors and may not be used
          without permission, except as needed to view and use the site.
        </p>
      </section>

      <section>
        <h2>Privacy</h2>
        <p>
          Our{" "}
          <Link href="/privacy" className="text-primary underline underline-offset-4">
            Privacy Policy
          </Link>{" "}
          explains how we handle personal information.
        </p>
      </section>

      <section>
        <h2>Disclaimers and limitation of liability</h2>
        <p>
          The site is provided &quot;as is&quot; without warranties of any kind, to the extent permitted by law. To the extent
          permitted by law, {siteConfig.name} is not liable for indirect, incidental, or consequential damages arising from
          your use of the site.
        </p>
      </section>

      <section>
        <h2>Governing law</h2>
        <p>These terms are governed by the laws of the State of Texas, without regard to conflict-of-law rules.</p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>We may update these terms. Continued use of the site after changes take effect means you accept them.</p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about these terms can be sent through our{" "}
          <Link href="/contact" className="text-primary underline underline-offset-4">
            contact form
          </Link>
          .
        </p>
      </section>
    </LegalPage>
  );
}
