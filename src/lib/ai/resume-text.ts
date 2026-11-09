import "server-only";

/**
 * Plain text from a stored resume. PDF via unpdf (pdf.js), Word via mammoth. Scanned PDFs have no text
 * layer, so they come back nearly empty — callers treat short results as "couldn't read".
 */
export async function extractResumeText(bytes: Uint8Array, mimeType: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    if (mimeType === "application/pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: true });
      return finish(Array.isArray(text) ? text.join("\n") : text);
    }
    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return finish(value);
    }
    return { ok: false, error: "Only PDF and Word (.docx) resumes can be read." };
  } catch (e) {
    console.error("Resume text extraction failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "The resume file couldn't be read." };
  }
}

function finish(text: string): { ok: true; text: string } | { ok: false; error: string } {
  if (text.replace(/\s/g, "").length < 200) {
    return { ok: false, error: "This resume has almost no text (it may be a scanned image). Ask the candidate for a text-based PDF or Word file." };
  }
  return { ok: true, text };
}
