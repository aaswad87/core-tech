import Link from "next/link";

import { LegalPage } from "@/components/marketing/legal-page";
import { siteConfig } from "@/config/site";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Privacy Policy",
  description: `How ${siteConfig.name} collects, uses, shares, and protects personal information.`,
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" path="/privacy" lastUpdated="October 30, 2026">
      <section>
        <p>
          This policy explains how {siteConfig.name} (&quot;CoreTech,&quot; &quot;we,&quot; &quot;us&quot;), a recruiting
          consultancy based in {siteConfig.location}, handles personal information collected through this website and in
          the course of our recruiting services.
        </p>
      </section>

      <section>
        <h2>Information we collect</h2>
        <ul>
          <li>
            <strong>Information you send us</strong> through our contact, hiring request, and candidate forms: your name,
            email address, phone number (optional), company and title, details about a role or the work you&apos;re
            looking for, and your message.
          </li>
          <li>
            <strong>Account information</strong> if you create an account: your name, email address, and password. Passwords
            are handled by our authentication provider and are never visible to us.
          </li>
          <li>
            <strong>Recruiting information</strong> our recruiters record when working with you, such as your experience,
            skills, and the roles you&apos;re interested in.
          </li>
          <li>
            <strong>Limited technical information.</strong> To prevent spam, we store a one-way, keyed hash of the IP address
            used to submit a form — not the address itself. If you sign in, we use cookies that keep you signed in. We do not
            use advertising or third-party tracking cookies.
          </li>
        </ul>
      </section>

      <section>
        <h2>How we use information</h2>
        <ul>
          <li>To respond to your inquiry and provide recruiting services.</li>
          <li>To match candidates with roles based on job-related skills and experience.</li>
          <li>To operate, secure, and improve our website and systems.</li>
          <li>To meet legal obligations.</li>
        </ul>
        <p>
          People make all hiring and placement decisions. We do not use automated systems to reject candidates or make
          employment decisions.
        </p>
      </section>

      <section>
        <h2>When we share information</h2>
        <ul>
          <li>
            <strong>With employers, only with your consent.</strong> We present a candidate to an employer only for a
            specific role and only after the candidate agrees. Our recruiters&apos; internal notes are not shared with
            employers.
          </li>
          <li>
            <strong>With service providers</strong> that host and operate our systems on our behalf (for example, our
            database, authentication, and website hosting providers), under obligations to protect the information.
          </li>
          <li>
            <strong>When required by law</strong> or to protect the rights, safety, and security of our users and others.
          </li>
        </ul>
        <p>We do not sell personal information.</p>
      </section>

      <section>
        <h2>How long we keep information</h2>
        <p>
          We keep information for as long as needed to provide our services and meet legal and business requirements, then
          delete or de-identify it. You can ask us to delete your information sooner.
        </p>
      </section>

      <section>
        <h2>Your choices and rights</h2>
        <p>
          You can ask to access, correct, or delete your personal information, or ask us to stop contacting you. Depending
          on where you live, you may have additional rights under applicable law. To make a request, use our{" "}
          <Link href="/contact" className="text-primary underline underline-offset-4">
            contact form
          </Link>
          . We may need to verify your identity before acting on a request.
        </p>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          We use access controls so that people see only the information their role requires, encrypt data in transit, and
          keep documents such as resumes in private storage. No system is perfectly secure, but we work to protect your
          information.
        </p>
      </section>

      <section>
        <h2>Children</h2>
        <p>Our services are intended for adults seeking employment and are not directed to children under 16.</p>
      </section>

      <section>
        <h2>Changes to this policy</h2>
        <p>We will update this page when our practices change and revise the &quot;Last updated&quot; date above.</p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about this policy can be sent through our{" "}
          <Link href="/contact" className="text-primary underline underline-offset-4">
            contact form
          </Link>
          .
        </p>
      </section>
    </LegalPage>
  );
}
