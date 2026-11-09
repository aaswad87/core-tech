import { createHash } from "node:crypto";

/** Signed resume download links are valid for this many seconds. */
export const RESUME_LINK_TTL_SECONDS = 60;

/** Must match the `resumes` bucket limit and the candidate_resumes check constraint. */
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;

export const RESUME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export type ResumeExtension = keyof typeof RESUME_TYPES;

export type ResumeCheck =
  | { ok: true; extension: ResumeExtension; mimeType: (typeof RESUME_TYPES)[ResumeExtension]; fileName: string; sha256: string }
  | { ok: false; error: string };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

/** Searches for an ASCII marker. ZIP entry names are stored uncompressed, so this finds DOCX parts. */
function containsAscii(bytes: Uint8Array, marker: string): boolean {
  const needle = Buffer.from(marker, "latin1");
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(needle);
}

/**
 * Keeps a display-safe file name: no path components or control characters, at most 255 characters,
 * and always ending in the detected extension.
 */
export function sanitizeFileName(name: string, extension: ResumeExtension): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.(pdf|docx)$/i, "");
  const stem = (cleaned || "resume").slice(0, 240);
  return `${stem}.${extension}`;
}

/**
 * Server-side validation of an uploaded resume. The browser's file type and extension are not trusted:
 * the content itself must be a PDF, or a Word (.docx) document without macros, within the size limit.
 */
export function checkResumeFile(bytes: Uint8Array, originalName: string): ResumeCheck {
  if (bytes.byteLength === 0) return { ok: false, error: "The file is empty." };
  if (bytes.byteLength > MAX_RESUME_BYTES) return { ok: false, error: "Resumes must be 4 MB or smaller." };

  const extMatch = /\.([a-z0-9]+)$/i.exec(originalName.trim());
  const ext = extMatch?.[1]?.toLowerCase();
  if (ext !== "pdf" && ext !== "docx") return { ok: false, error: "Upload a PDF or Word (.docx) file." };

  if (ext === "pdf") {
    if (!startsWith(bytes, PDF_MAGIC)) return { ok: false, error: "This file isn't a valid PDF." };
  } else {
    const isDocx =
      startsWith(bytes, ZIP_MAGIC) && containsAscii(bytes, "[Content_Types].xml") && containsAscii(bytes, "word/document.xml");
    if (!isDocx) return { ok: false, error: "This file isn't a valid Word (.docx) document." };
    if (containsAscii(bytes, "vbaProject.bin")) {
      return { ok: false, error: "Documents containing macros can't be uploaded. Save the resume as a regular .docx or PDF." };
    }
  }

  return {
    ok: true,
    extension: ext,
    mimeType: RESUME_TYPES[ext],
    fileName: sanitizeFileName(originalName, ext),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
