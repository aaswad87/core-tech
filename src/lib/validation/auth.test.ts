import { describe, expect, it } from "vitest";

import { canManageRolesOf, isStaff } from "@/lib/auth/roles";
import { roleChangeSchema, signInSchema, signUpSchema, toFieldErrors } from "@/lib/validation/auth";

const validSignUp = {
  fullName: "  Jordan Demo ",
  email: " Jordan@Example.TEST ",
  password: "Str0ngPassword",
  confirmPassword: "Str0ngPassword",
};

describe("signUpSchema", () => {
  it("normalizes name and email", () => {
    const result = signUpSchema.parse(validSignUp);
    expect(result.fullName).toBe("Jordan Demo");
    expect(result.email).toBe("jordan@example.test");
  });

  it.each([
    ["short", "Ab1"],
    ["no uppercase", "lowercase123"],
    ["no digit", "NoDigitsHere"],
    ["over 72 bytes", `Aa1${"é".repeat(40)}`],
  ])("rejects a weak password (%s)", (_label, password) => {
    const result = signUpSchema.safeParse({ ...validSignUp, password, confirmPassword: password });
    expect(result.success).toBe(false);
    if (!result.success) expect(toFieldErrors(result.error).password).toBeDefined();
  });

  it("requires matching confirmation", () => {
    const result = signUpSchema.safeParse({ ...validSignUp, confirmPassword: "Different123" });
    expect(result.success).toBe(false);
    if (!result.success) expect(toFieldErrors(result.error).confirmPassword).toBe("Passwords do not match.");
  });

  it("does not accept a role field", () => {
    const result = signUpSchema.parse({ ...validSignUp, role: "admin" });
    expect(result).not.toHaveProperty("role");
  });
});

describe("signInSchema", () => {
  it("rejects an invalid email without checking password strength", () => {
    expect(signInSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "a@b.test", password: "x" }).success).toBe(true);
  });
});

describe("roleChangeSchema", () => {
  it("accepts only known roles and UUIDs", () => {
    expect(roleChangeSchema.safeParse({ userId: crypto.randomUUID(), role: "recruiter" }).success).toBe(true);
    expect(roleChangeSchema.safeParse({ userId: crypto.randomUUID(), role: "superuser" }).success).toBe(false);
    expect(roleChangeSchema.safeParse({ userId: "1 or 1=1", role: "admin" }).success).toBe(false);
  });
});

describe("role helpers", () => {
  it("treats only admins and recruiters as staff", () => {
    expect(isStaff(["recruiter"])).toBe(true);
    expect(isStaff(["employer", "candidate"])).toBe(false);
  });

  it("lets admins manage roles of others but not themselves", () => {
    expect(canManageRolesOf({ id: "a", roles: ["admin"] }, "b")).toBe(true);
    expect(canManageRolesOf({ id: "a", roles: ["admin"] }, "a")).toBe(false);
    expect(canManageRolesOf({ id: "a", roles: ["recruiter"] }, "b")).toBe(false);
  });
});
