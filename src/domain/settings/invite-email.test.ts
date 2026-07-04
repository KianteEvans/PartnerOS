import { describe, it, expect } from "vitest";
import { inviteEmail } from "@/domain/settings/invite-email";

describe("inviteEmail", () => {
  const msg = inviteEmail({
    email: "new.user@example.com",
    role: "manager",
    origin: "https://partners.example.com",
  });

  it("is ASCII-only (WIN1252-safe relay + audit trail)", () => {
    expect(msg.subject).toMatch(/^[\x20-\x7E]*$/);
    expect(msg.body).toMatch(/^[\x20-\x7E\n]*$/);
  });

  it("addresses the invitee and names the role and sign-in origin", () => {
    expect(msg.to).toBe("new.user@example.com");
    expect(msg.body).toContain("manager");
    expect(msg.body).toContain("https://partners.example.com/");
    expect(msg.body).toContain("new.user@example.com");
  });

  it("never invents a token link (invites are consumed by email match at sign-in)", () => {
    expect(msg.subject.toLowerCase()).not.toContain("token");
    expect(msg.body.toLowerCase()).not.toContain("token");
    // No querystring-style accept links either.
    expect(msg.body).not.toMatch(/[?&](invite|token|code)=/i);
  });
});
