import { describe, expect, it } from "vitest";

import { DEFAULT_AFTER_LOGIN, safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("keeps same-origin relative paths with query and hash", () => {
    expect(safeNextPath("/admin/users?q=ann#top")).toBe("/admin/users?q=ann#top");
    expect(safeNextPath("/account")).toBe("/account");
  });

  it.each([
    "https://evil.test",
    "//evil.test/path",
    "/\\evil.test",
    "\\\\evil.test",
    "javascript:alert(1)",
    "account",
    "/foo\nbar",
    "/%0d%0aLocation:evil",
    "",
    "/" + "a".repeat(600),
  ])("rejects unsafe value %j", (value) => {
    const result = safeNextPath(value);
    expect(result.startsWith("/")).toBe(true);
    expect(result.startsWith("//")).toBe(false);
    if (value !== "/%0d%0aLocation:evil") expect(result).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("rejects non-strings and honors a custom fallback", () => {
    expect(safeNextPath(undefined)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath(["/a"], "/reset-password")).toBe("/reset-password");
  });
});
