import { ForbiddenError } from "@/http/errors";
import type { ServerIdentity } from "@/auth/session";

/**
 * Role-based permissions. The gate consults this before any mutation (Rule 6).
 * Permissions are stable string ids in the form "<resource>:<action>". Keep this
 * the single authority on who-can-do-what; route handlers never re-implement it.
 */

export type Role = ServerIdentity["role"];

export type Permission =
  | "tenant:read"
  | "tenant:update"
  | "user:read"
  | "user:invite"
  | "user:update"
  | "user:erase"
  | "audit:read"
  // domain permissions land here as features are built:
  | "mdf:read"
  | "mdf:create"
  | "mdf:update"
  | "mdf:approve"
  | "funding:read"
  | "funding:create"
  | "funding:update"
  | "funding:submit"
  | "funding:approve"
  | "playbook:read"
  | "playbook:create"
  | "playbook:update"
  | "playbook:delete"
  | "playbook:approve"
  | "playbook:run"
  | "notification:read"
  | "notification:dismiss"
  | "benchmark:read"
  | "portfolio:read"
  | "portfolio:manage"
  | "assessment:read"
  | "assessment:create"
  | "assessment:update"
  | "assessment:submit"
  | "assessment:approve"
  | "assessment:delete"
  | "task:read"
  | "task:create"
  | "task:update"
  | "task:complete"
  | "onboarding:read"
  | "onboarding:manage"
  | "roadmap:read"
  | "roadmap:create"
  | "roadmap:update"
  | "roadmap:finalize"
  | "roadmap:archive"
  | "evidence:read"
  | "evidence:create"
  | "evidence:update"
  | "evidence:review"
  | "program:read"
  | "program:create"
  | "program:update"
  | "program:submit"
  | "application:read"
  | "application:create"
  | "application:update"
  | "case_study:read"
  | "case_study:create"
  | "case_study:update"
  | "solution:read"
  | "solution:create"
  | "solution:update"
  | "marketplace:read"
  | "marketplace:create"
  | "marketplace:update"
  | "marketplace:publish"
  | "marketplace:sync"
  | "tier:read"
  | "tier:create"
  | "tier:update"
  | "tier:advance"
  | "ace:read"
  | "ace:create"
  | "ace:update"
  | "ace:approve"
  | "ace_goal:read"
  | "ace_goal:create"
  | "ace_goal:update"
  | "report:read"
  | "report:create"
  | "report:update"
  | "report:approve"
  | "command:read"
  | "settings:read"
  | "settings:manage"
  // Personal list presets — every authenticated role manages its own.
  | "view:manage";

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    "tenant:read",
    "funding:read",
    "funding:create",
    "funding:update",
    "funding:submit",
    "funding:approve",
    "playbook:read",
    "playbook:create",
    "playbook:update",
    "playbook:delete",
    "playbook:approve",
    "playbook:run",
    "notification:read",
    "notification:dismiss",
    "benchmark:read",
    "portfolio:read",
    "portfolio:manage",
    "tenant:update",
    "user:read",
    "user:invite",
    "user:update",
    "user:erase",
    "audit:read",
    "mdf:read",
    "mdf:create",
    "mdf:update",
    "mdf:approve",
    "assessment:read",
    "assessment:create",
    "assessment:update",
    "assessment:submit",
    "assessment:approve",
    "assessment:delete",
    "task:read",
    "task:create",
    "task:update",
    "task:complete",
    "onboarding:read",
    "onboarding:manage",
    "roadmap:read",
    "roadmap:create",
    "roadmap:update",
    "roadmap:finalize",
    "roadmap:archive",
    "evidence:read",
    "evidence:create",
    "evidence:update",
    "evidence:review",
    "program:read",
    "program:create",
    "program:update",
    "program:submit",
    "tier:read",
    "tier:create",
    "tier:update",
    "tier:advance",
    "ace:read",
    "ace:create",
    "ace:update",
    "ace:approve",
    "ace_goal:read",
    "ace_goal:create",
    "ace_goal:update",
    "report:read",
    "report:create",
    "report:update",
    "report:approve",
    "command:read",
    "settings:read",
    "settings:manage",
    "application:read",
    "application:create",
    "application:update",
    "case_study:read",
    "case_study:create",
    "case_study:update",
    "solution:read",
    "solution:create",
    "solution:update",
    "marketplace:read",
    "marketplace:create",
    "marketplace:update",
    "marketplace:publish",
    "marketplace:sync",
    "view:manage",
  ]),
  admin: new Set<Permission>([
    "tenant:read",
    "funding:read",
    "funding:create",
    "funding:update",
    "funding:submit",
    "funding:approve",
    "playbook:read",
    "playbook:create",
    "playbook:update",
    "playbook:delete",
    "playbook:approve",
    "playbook:run",
    "notification:read",
    "notification:dismiss",
    "benchmark:read",
    "portfolio:read",
    "portfolio:manage",
    "tenant:update",
    "user:read",
    "user:invite",
    "user:update",
    "user:erase",
    "audit:read",
    "mdf:read",
    "mdf:create",
    "mdf:update",
    "mdf:approve",
    "assessment:read",
    "assessment:create",
    "assessment:update",
    "assessment:submit",
    "assessment:approve",
    "assessment:delete",
    "task:read",
    "task:create",
    "task:update",
    "task:complete",
    "onboarding:read",
    "onboarding:manage",
    "roadmap:read",
    "roadmap:create",
    "roadmap:update",
    "roadmap:finalize",
    "roadmap:archive",
    "evidence:read",
    "evidence:create",
    "evidence:update",
    "evidence:review",
    "program:read",
    "program:create",
    "program:update",
    "program:submit",
    "tier:read",
    "tier:create",
    "tier:update",
    "tier:advance",
    "ace:read",
    "ace:create",
    "ace:update",
    "ace:approve",
    "ace_goal:read",
    "ace_goal:create",
    "ace_goal:update",
    "report:read",
    "report:create",
    "report:update",
    "report:approve",
    "command:read",
    "settings:read",
    "settings:manage",
    "application:read",
    "application:create",
    "application:update",
    "case_study:read",
    "case_study:create",
    "case_study:update",
    "solution:read",
    "solution:create",
    "solution:update",
    "marketplace:read",
    "marketplace:create",
    "marketplace:update",
    "marketplace:publish",
    "marketplace:sync",
    "view:manage",
  ]),
  // A manager runs assessments end-to-end: prepare, submit, and approve the
  // recommendations. (This is deliberately broader than mdf:approve, which is
  // admin/owner only — approving a readiness recommendation is lower-stakes
  // than approving partner funding.)
  manager: new Set<Permission>([
    "tenant:read",
    "funding:read",
    "funding:create",
    "funding:update",
    "funding:submit",
    "playbook:read",
    "playbook:create",
    "playbook:update",
    "playbook:approve",
    "playbook:run",
    "notification:read",
    "notification:dismiss",
    "benchmark:read",
    "user:read",
    "audit:read",
    "mdf:read",
    "mdf:create",
    "mdf:update",
    "assessment:read",
    "assessment:create",
    "assessment:update",
    "assessment:submit",
    "assessment:approve",
    "task:read",
    "task:create",
    "task:update",
    "task:complete",
    "onboarding:read",
    "roadmap:read",
    "roadmap:create",
    "roadmap:update",
    "roadmap:finalize",
    "roadmap:archive",
    "evidence:read",
    "evidence:create",
    "evidence:update",
    "evidence:review",
    "program:read",
    "program:create",
    "program:update",
    "program:submit",
    "tier:read",
    "tier:create",
    "tier:update",
    "ace:read",
    "ace:create",
    "ace:update",
    "ace:approve",
    "ace_goal:read",
    "ace_goal:create",
    "ace_goal:update",
    "report:read",
    "report:create",
    "report:update",
    "report:approve",
    "command:read",
    "settings:read",
    "application:read",
    "application:create",
    "application:update",
    "case_study:read",
    "case_study:create",
    "case_study:update",
    "solution:read",
    "solution:create",
    "solution:update",
    "marketplace:read",
    "marketplace:create",
    "marketplace:update",
    "marketplace:publish",
    "marketplace:sync",
    "view:manage",
  ]),
  // A member prepares draft assessments; submitting and approving are gated.
  // Members own task execution: create, update, and complete their work.
  member: new Set<Permission>([
    "tenant:read",
    "funding:read",
    "funding:create",
    "funding:update",
    "playbook:read",
    "notification:read",
    "notification:dismiss",
    "benchmark:read",
    "user:read",
    "mdf:read",
    "mdf:create",
    "mdf:update",
    "assessment:read",
    "assessment:create",
    "assessment:update",
    "task:read",
    "task:create",
    "task:update",
    "task:complete",
    "onboarding:read",
    "roadmap:read",
    "roadmap:create",
    "roadmap:update",
    "ace:read",
    "ace:create",
    "ace:update",
    "ace_goal:read",
    "ace_goal:create",
    "ace_goal:update",
    "report:read",
    "report:create",
    "report:update",
    "command:read",
    "settings:read",
    "marketplace:read",
    "marketplace:create",
    "marketplace:update",
    "view:manage",
  ]),
  viewer: new Set<Permission>([
    "tenant:read",
    "funding:read",
    "playbook:read",
    "notification:read",
    "benchmark:read",
    "user:read",
    "mdf:read",
    "assessment:read",
    "task:read",
    "onboarding:read",
    "roadmap:read",
    "evidence:read",
    "program:read",
    "tier:read",
    "ace:read",
    "ace_goal:read",
    "report:read",
    "command:read",
    "settings:read",
    "application:read",
    "case_study:read",
    "solution:read",
    "marketplace:read",
    "view:manage",
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Throw ForbiddenError unless the identity's role holds the permission. */
export function requirePermission(
  identity: Pick<ServerIdentity, "role">,
  permission: Permission,
): void {
  if (!can(identity.role, permission)) {
    throw new ForbiddenError(
      `Role '${identity.role}' lacks permission '${permission}'`,
    );
  }
}
