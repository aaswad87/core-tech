import { describe, expect, it } from "vitest";

import { siteConfig } from "@/config/site";

import { type LeadForEmail, leadRecipient, renderLeadEmail, safeReplyTo } from "./notify";

const base: LeadForEmail = {
  type: "contact",
  full_name: "Jordan Lee",
  email: "jordan@example.com",
  phone: null,
  topic: "general",
  company_name: null,
  contact_title: null,
  role_title: null,
  location: null,
  positions_count: null,
  timeline: null,
  specialty: null,
  message: "Hello there",
  source_path: "/contact",
};

describe("lead email alerts", () => {
  it("routes hiring requests to sales@ and everything else to info@", () => {
    expect(leadRecipient("employer")).toBe(siteConfig.email.sales);
    expect(leadRecipient("contact")).toBe(siteConfig.email.info);
    expect(leadRecipient("candidate")).toBe(siteConfig.email.info);
    expect(siteConfig.email.info).toBe("info@coretechrecruiting.com");
  });

  it("uses readable labels and links to the Leads inbox", () => {
    const { subject, text, html } = renderLeadEmail(base, "https://coretechrecruiting.com");
    expect(subject).toBe("Contact message: Jordan Lee — General question");
    expect(text).toContain("Leads inbox: https://coretechrecruiting.com/admin/leads");
    expect(html).toContain("Hello there");
  });

  it("escapes everything the visitor typed and keeps the subject on one line", () => {
    const { subject, html } = renderLeadEmail(
      { ...base, type: "employer", full_name: "Eve\r\nBcc: x@y.z", role_title: "<script>alert(1)</script>", company_name: "A&B", message: "<img src=x onerror=alert(1)>" },
      "https://coretechrecruiting.com",
    );
    expect(subject).not.toMatch(/[\r\n]/);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A&amp;B");
  });

  it("only uses a single plain address as Reply-To", () => {
    expect(safeReplyTo("jordan@example.com")).toBe("jordan@example.com");
    expect(safeReplyTo("a@b.com, c@d.com")).toBeNull();
    expect(safeReplyTo("Eve <eve@x.com>")).toBeNull();
  });
});
