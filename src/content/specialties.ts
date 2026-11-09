export type SpecialtySlug = "it-recruiting" | "networking" | "cybersecurity" | "cloud" | "telecommunications";

export type Specialty = {
  slug: SpecialtySlug;
  name: string;
  /** One-line summary for cards and meta descriptions. */
  summary: string;
  headline: string;
  intro: string;
  roles: string[];
  skills: string[];
  focusAreas: { title: string; body: string }[];
};

export const specialties: Specialty[] = [
  {
    slug: "it-recruiting",
    name: "IT Recruiting",
    summary: "Direct-hire recruiting for infrastructure, systems, and IT operations teams.",
    headline: "IT recruiting for the teams that keep the business running",
    intro:
      "We recruit the systems, support, and infrastructure professionals behind day-to-day IT operations — from service desk leads to systems engineers and IT managers. Every search starts with a clear picture of the environment the person will support.",
    roles: [
      "Systems Administrators and Systems Engineers",
      "IT Support and Service Desk Leads",
      "Infrastructure and Data Center Engineers",
      "Virtualization and Storage Engineers",
      "IT Managers and Infrastructure Leaders",
      "Automation and Scripting Engineers",
    ],
    skills: [
      "Windows Server and Active Directory",
      "Linux administration",
      "VMware and Hyper-V",
      "Microsoft 365 and Intune",
      "PowerShell and Python automation",
      "ITIL service management",
    ],
    focusAreas: [
      {
        title: "Environment-first screening",
        body: "We ask about the platforms, scale, and on-call expectations of your environment so candidates are measured against the job you actually have.",
      },
      {
        title: "Hands-on experience over keywords",
        body: "We look for evidence of work done — migrations run, systems supported, incidents resolved — not just a list of tools on a resume.",
      },
      {
        title: "Career-level alignment",
        body: "We match scope and seniority carefully, so a senior engineer isn't placed in a junior role or the reverse.",
      },
    ],
  },
  {
    slug: "networking",
    name: "Networking",
    summary: "Network engineers, architects, and operations staff across enterprise and service-provider environments.",
    headline: "Network engineering talent, from the NOC to architecture",
    intro:
      "Networks underpin everything else. We recruit engineers who design, build, and operate routing, switching, wireless, and SD-WAN environments, and we understand the difference between supporting a campus network and running a carrier backbone.",
    roles: [
      "Network Engineers and Senior Network Engineers",
      "Network Architects",
      "NOC Engineers and Network Operations Leads",
      "Wireless Network Engineers",
      "Network Automation Engineers",
      "Network Security Engineers",
    ],
    skills: [
      "Routing and switching (BGP, OSPF, MPLS)",
      "SD-WAN and SASE platforms",
      "Enterprise wireless design",
      "Firewalls and network segmentation",
      "Network automation with Python and Ansible",
      "Certifications such as CCNA, CCNP, CCIE, and JNCIP",
    ],
    focusAreas: [
      {
        title: "Technical depth that matches the role",
        body: "We distinguish between operations, engineering, and architecture work and screen for the depth each one needs.",
      },
      {
        title: "Vendor and platform fit",
        body: "We confirm hands-on experience with the platforms in your environment and note where a candidate would need ramp-up time.",
      },
      {
        title: "Operational readiness",
        body: "For roles with change windows or on-call rotation, we discuss expectations up front so there are no surprises at offer stage.",
      },
    ],
  },
  {
    slug: "cybersecurity",
    name: "Cybersecurity",
    summary: "Security analysts, engineers, and leaders for SOC, identity, cloud security, and GRC teams.",
    headline: "Cybersecurity professionals who can defend real environments",
    intro:
      "Security teams need people who can investigate, engineer, and govern. We recruit across security operations, identity and access management, cloud security, and governance, risk, and compliance — and we handle candidate information with the care this field expects.",
    roles: [
      "SOC Analysts and Incident Responders",
      "Security Engineers",
      "Identity and Access Management Engineers",
      "Cloud Security Engineers",
      "GRC Analysts and Compliance Specialists",
      "Security Architects and Security Managers",
    ],
    skills: [
      "SIEM and SOAR platforms",
      "Endpoint detection and response",
      "Identity platforms and zero-trust access",
      "Vulnerability management",
      "Frameworks such as NIST CSF, ISO 27001, and SOC 2",
      "Certifications such as Security+, CySA+, CISSP, and CISM",
    ],
    focusAreas: [
      {
        title: "Role clarity",
        body: "\"Security engineer\" means different things in different companies. We pin down whether the role is operational, engineering, or advisory before we search.",
      },
      {
        title: "Clearance and compliance needs",
        body: "When a role requires a clearance, background check, or specific compliance experience, we confirm it early in the process.",
      },
      {
        title: "Discretion",
        body: "Many security professionals are passively looking. We keep conversations confidential and share profiles only with consent.",
      },
    ],
  },
  {
    slug: "cloud",
    name: "Cloud",
    summary: "Cloud, platform, and DevOps engineers for AWS, Azure, and Google Cloud.",
    headline: "Cloud and platform engineers for modern infrastructure",
    intro:
      "We recruit engineers who build and run infrastructure in the public cloud: platform and DevOps engineers, cloud architects, and site reliability engineers who work with infrastructure as code, containers, and CI/CD.",
    roles: [
      "Cloud Engineers and Cloud Architects",
      "DevOps and Platform Engineers",
      "Site Reliability Engineers",
      "Kubernetes and Container Platform Engineers",
      "Cloud Migration Specialists",
      "FinOps and Cloud Cost Analysts",
    ],
    skills: [
      "AWS, Microsoft Azure, and Google Cloud",
      "Terraform and other infrastructure as code",
      "Kubernetes and containers",
      "CI/CD pipelines",
      "Observability and monitoring",
      "Certifications such as AWS Solutions Architect and Azure Administrator",
    ],
    focusAreas: [
      {
        title: "Platform-specific experience",
        body: "We confirm which cloud providers and services a candidate has run in production, not just studied.",
      },
      {
        title: "Build versus operate",
        body: "We separate greenfield builders from people who excel at operating and improving existing platforms, and match accordingly.",
      },
      {
        title: "Practical evaluation",
        body: "We discuss real projects — migrations, automation, outages handled — to understand how a candidate works.",
      },
    ],
  },
  {
    slug: "telecommunications",
    name: "Telecommunications",
    summary: "RF, fiber, wireless, and carrier specialists for telecom build-outs and operations.",
    headline: "Telecommunications specialists for wireless, fiber, and carrier networks",
    intro:
      "Telecom projects depend on specialized skills that general IT recruiters often miss. We recruit RF engineers, fiber and outside-plant professionals, and carrier network engineers for build-outs, upgrades, and ongoing operations.",
    roles: [
      "RF Engineers and RF Optimization Engineers",
      "Fiber and Outside Plant Engineers",
      "Wireless and 5G Network Engineers",
      "Carrier and Transport Network Engineers",
      "Telecom Project Managers",
      "Voice and Unified Communications Engineers",
    ],
    skills: [
      "LTE and 5G RAN",
      "RF planning and drive-test tools",
      "DWDM and optical transport",
      "Fiber design and splicing",
      "VoIP, SIP, and unified communications",
      "Site acquisition and construction coordination",
    ],
    focusAreas: [
      {
        title: "Field and office roles",
        body: "We account for travel, field work, and safety requirements when presenting candidates for telecom roles.",
      },
      {
        title: "Project timelines",
        body: "Build-outs run on tight schedules. We plan searches around your project milestones and start dates.",
      },
      {
        title: "Specialized vocabulary",
        body: "We understand the difference between RAN, transport, and core roles and screen candidates in those terms.",
      },
    ],
  },
];

export function getSpecialty(slug: string): Specialty | undefined {
  return specialties.find((s) => s.slug === slug);
}

/** Options for "area of interest" selects in lead forms. */
export const specialtyOptions = [
  ...specialties.map((s) => ({ value: s.slug, label: s.name })),
  { value: "other", label: "Something else" },
] as const;

export const SPECIALTY_VALUES: [string, ...string[]] = ["other", ...specialties.map((s) => s.slug)];
