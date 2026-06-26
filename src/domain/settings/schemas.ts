import { z } from "zod";

/** Settings payload schemas. Generic helpers live in @/domain/forms. */

export const automationModeEnum = z.enum([
  "off",
  "recommend_only",
  "auto_with_approval",
  "autonomous",
]);

export const roleEnum = z.enum(["owner", "admin", "manager", "member", "viewer"]);

export const connectorKindEnum = z.enum([
  "ace",
  "salesforce",
  "marketplace",
  "aws_context",
  "mdf_import",
  "csv",
  "notetaker",
]);

export const connectorStatusEnum = z.enum(["configured", "disabled"]);

export const workspaceSettingsSchema = z.object({
  displayName: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(200)),
  automationMode: automationModeEnum,
  emailNotifications: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export const userRoleSchema = z.object({
  userId: z.string().uuid(),
  role: roleEnum,
});

export const userStatusEnum = z.enum(["active", "disabled"]);

export const userStatusSchema = z.object({
  userId: z.string().uuid(),
  status: userStatusEnum,
});

export const inviteUserSchema = z.object({
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().email().max(200),
  ),
  role: roleEnum,
});

export const revokeInvitationSchema = z.object({
  invitationId: z.string().uuid(),
});

export const revokeSessionsSchema = z.object({
  userId: z.string().uuid(),
});

export const configureConnectorSchema = z.object({
  kind: connectorKindEnum,
  endpoint: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(500)),
  authMode: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(100)),
});
