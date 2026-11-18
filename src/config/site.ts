import { specialties } from "@/content/specialties";

export type NavItem = {
  title: string;
  href: string;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

/** Only routes that exist belong here. */
export const mainNav: NavItem[] = [
  { title: "Services", href: "/services" },
  { title: "Employers", href: "/employers" },
  { title: "Candidates", href: "/candidates" },
  { title: "Jobs", href: "/jobs" },
  { title: "About", href: "/about" },
  { title: "Contact", href: "/contact" },
];

export const footerNav: NavGroup[] = [
  {
    title: "Services",
    items: [
      { title: "All services", href: "/services" },
      ...specialties.map((s) => ({ title: s.name, href: `/services/${s.slug}` })),
    ],
  },
  {
    title: "Work with us",
    items: [
      { title: "Employers", href: "/employers" },
      { title: "Candidates", href: "/candidates" },
      { title: "Open jobs", href: "/jobs" },
    ],
  },
  {
    title: "Company",
    items: [
      { title: "About", href: "/about" },
      { title: "Contact", href: "/contact" },
      { title: "Privacy policy", href: "/privacy" },
      { title: "Terms of use", href: "/terms" },
    ],
  },
];

export const siteConfig = {
  name: "CoreTech Recruiting",
  shortName: "CoreTech",
  tagline: "Connecting Technical Talent. Powering Business.",
  description:
    "CoreTech Recruiting is a Texas-based IT and telecommunications recruiting consultancy placing technical talent in networking, cybersecurity, cloud, and telecom roles.",
  location: "Texas, USA",
  /** Public business mailboxes (Zoho Mail, set up 2026-11-18). Website form notifications go here too. */
  email: {
    info: "info@coretechrecruiting.com",
    sales: "sales@coretechrecruiting.com",
  },
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
} as const;
