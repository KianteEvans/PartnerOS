import type { EmailMessage } from "@/notifications/delivery";

/**
 * Compose the invitation email. Pure and ASCII-only (the relay + audit trail
 * must stay WIN1252-safe).
 *
 * IMPORTANT: invitations are consumed by EMAIL MATCH at the invitee's first
 * OIDC sign-in (auth/provision.ts) — the invitation token column is never read.
 * So the email tells the recipient to sign in with this exact address at the
 * workspace origin; it must NOT invent a token link.
 */
export function inviteEmail({
  email,
  role,
  origin,
}: {
  readonly email: string;
  readonly role: string;
  readonly origin: string;
}): EmailMessage {
  return {
    to: email,
    subject: "You have been invited to a PartnerOS workspace",
    body: [
      "Hello,",
      "",
      `You have been invited to join a PartnerOS workspace as ${role}.`,
      "",
      `To accept, sign in at ${origin}/ using this email address (${email}).`,
      "Your access is provisioned automatically on first sign-in.",
      "",
      "If you were not expecting this invitation, you can ignore this email.",
    ].join("\n"),
  };
}
