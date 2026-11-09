import { describe, expect, it } from "vitest";

import { describeActivity, formatBytes } from "@/lib/candidates/format";
import { checkResumeFile, MAX_RESUME_BYTES, sanitizeFileName } from "@/lib/candidates/resume-file";
import { candidatesHref, parseCandidateSearch, toSearchRpcArgs } from "@/lib/candidates/search";
import {
  candidateFormSchema,
  certificationSchema,
  parseTags,
  skillSchema,
  workHistorySchema,
} from "@/lib/candidates/validation";

const enc = (s: string) => new TextEncoder().encode(s);
const pdf = enc("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
/** Minimal byte layout that looks like a .docx ZIP: local header magic plus the part names. */
const docx = enc("PK\u0003\u0004....[Content_Types].xml....word/document.xml....");

describe("checkResumeFile", () => {
  it("accepts a real PDF and DOCX, detecting type from content", () => {
    const p = checkResumeFile(pdf, "Alex Rivera Resume.PDF");
    expect(p).toMatchObject({ ok: true, extension: "pdf", mimeType: "application/pdf", fileName: "Alex Rivera Resume.pdf" });
    expect(p.ok && p.sha256).toMatch(/^[0-9a-f]{64}$/);

    expect(checkResumeFile(docx, "cv.docx")).toMatchObject({ ok: true, extension: "docx" });
  });

  it("rejects files whose content doesn't match the extension", () => {
    expect(checkResumeFile(enc("MZ\u0090 executable"), "resume.pdf")).toMatchObject({ ok: false });
    expect(checkResumeFile(pdf, "resume.docx")).toMatchObject({ ok: false });
    expect(checkResumeFile(enc("PK\u0003\u0004 just a zip"), "resume.docx")).toMatchObject({ ok: false });
  });

  it("rejects other types, macro documents, empty and oversized files", () => {
    expect(checkResumeFile(pdf, "resume.exe")).toMatchObject({ ok: false, error: "Upload a PDF or Word (.docx) file." });
    expect(checkResumeFile(pdf, "resume")).toMatchObject({ ok: false });
    expect(checkResumeFile(enc("PK\u0003\u0004[Content_Types].xml word/document.xml word/vbaProject.bin"), "r.docx")).toMatchObject({
      ok: false,
    });
    expect(checkResumeFile(new Uint8Array(0), "r.pdf")).toMatchObject({ ok: false, error: "The file is empty." });
    const big = new Uint8Array(MAX_RESUME_BYTES + 1);
    big.set(pdf);
    expect(checkResumeFile(big, "r.pdf")).toMatchObject({ ok: false, error: "Resumes must be 4 MB or smaller." });
  });

  it("sanitizes display names", () => {
    expect(sanitizeFileName("../../etc/passwd.pdf", "pdf")).toBe("passwd.pdf");
    expect(sanitizeFileName("C:\\Users\\x\\My<CV>.docx", "docx")).toBe("MyCV.docx");
    expect(sanitizeFileName("\u0000\u0007.pdf", "pdf")).toBe("resume.pdf");
    expect(sanitizeFileName(`${"a".repeat(400)}.pdf`, "pdf")).toHaveLength(244);
  });
});

describe("candidate validation", () => {
  it("normalizes and validates tags", () => {
    expect(parseTags("CCNP, Open  to Relocation, ccnp, ,")).toEqual({ tags: ["ccnp", "open to relocation"], invalid: [] });
    expect(parseTags("ok, <script>").invalid).toEqual(["<script>"]);

    const tooMany = Array.from({ length: 21 }, (_, i) => `t${i}`).join(",");
    expect(candidateFormSchema.safeParse({ firstName: "A", lastName: "B", tags: tooMany }).success).toBe(false);
  });

  it("requires names and treats blank optionals as empty", () => {
    const parsed = candidateFormSchema.parse({ firstName: " Alex ", lastName: "Rivera", email: "", phone: "", ownerId: "", tags: "" });
    expect(parsed).toMatchObject({ firstName: "Alex", email: undefined, ownerId: undefined, tags: [] });
    expect(candidateFormSchema.safeParse({ firstName: "", lastName: "B" }).success).toBe(false);
    expect(candidateFormSchema.safeParse({ firstName: "A", lastName: "B", ownerId: "not-a-uuid" }).success).toBe(false);
  });

  it("validates skills, certifications and work history", () => {
    expect(skillSchema.parse({ name: "BGP", yearsExperience: "6.5" }).yearsExperience).toBe(6.5);
    expect(skillSchema.safeParse({ name: "BGP", yearsExperience: "6.3" }).success).toBe(false);
    expect(skillSchema.safeParse({ name: "BGP", yearsExperience: "-1" }).success).toBe(false);

    expect(certificationSchema.safeParse({ name: "CCNP", issuedOn: "2024-05-01", expiresOn: "2023-01-01" }).success).toBe(false);
    expect(certificationSchema.safeParse({ name: "CCNP", issuedOn: "2024-13-45" }).success).toBe(false);

    const work = workHistorySchema.parse({ companyName: "Demo", title: "Engineer", startDate: "2020-03", isCurrent: "on" });
    expect(work).toMatchObject({ startDate: "2020-03-01", isCurrent: true });
    expect(work.endDate).toBeUndefined();
    expect(workHistorySchema.safeParse({ companyName: "D", title: "E", endDate: "2021-01", isCurrent: "on" }).success).toBe(false);
    expect(workHistorySchema.safeParse({ companyName: "D", title: "E", startDate: "2022-01", endDate: "2021-01" }).success).toBe(false);
  });
});

describe("candidate search params", () => {
  const me = "11111111-1111-4111-8111-111111111111";

  it("normalizes untrusted params", () => {
    expect(parseCandidateSearch({ q: " alex ", owner: "me", tag: "CCNP", page: "2" })).toEqual({
      query: "alex",
      owner: "me",
      tag: "ccnp",
      skill: "",
      page: 2,
    });
    expect(parseCandidateSearch({ owner: "'; drop table", page: "-3" })).toMatchObject({ owner: "any", page: 1 });
  });

  it("maps owner filters to RPC arguments", () => {
    expect(toSearchRpcArgs(parseCandidateSearch({ owner: "me" }), me)).toMatchObject({ p_owner_id: me, p_unowned: false });
    expect(toSearchRpcArgs(parseCandidateSearch({ owner: "unowned" }), me)).toMatchObject({ p_owner_id: null, p_unowned: true });
    expect(toSearchRpcArgs(parseCandidateSearch({ page: "3" }), me)).toMatchObject({ p_limit: 25, p_offset: 50 });
  });

  it("builds filter-preserving links", () => {
    expect(candidatesHref(parseCandidateSearch({ q: "bgp", owner: "me" }), { page: 2 })).toBe(
      "/recruiter/candidates?q=bgp&owner=me&page=2",
    );
  });
});

describe("activity descriptions", () => {
  it("describes entries without exposing internals", () => {
    const names = new Map([
      ["u1", "Riley Recruiter"],
      ["u2", "Sam Staff"],
    ]);
    expect(describeActivity({ action: "candidate.updated", details: { fields: ["headline", "owner_id"] } }, names)).toBe(
      "Updated headline, owner",
    );
    expect(describeActivity({ action: "candidate.owner_changed", details: { from_owner: "u1", to_owner: "u2" } }, names)).toBe(
      "Changed owner from Riley Recruiter to Sam Staff",
    );
    expect(describeActivity({ action: "note.added", details: {} }, names)).toBe("Added an internal note");
    expect(describeActivity({ action: "resume.added", details: { file_name: "cv.pdf" } }, names)).toBe("Uploaded resume “cv.pdf”");
  });

  it("formats file sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});
