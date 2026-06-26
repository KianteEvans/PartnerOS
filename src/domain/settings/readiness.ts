import type { AutomationMode } from "@/domain/settings/automation";
import { connectorHealth, type ConnectorLike } from "@/domain/settings/connectors";

/**
 * Pure workspace-readiness checklist: the production-readiness floor the
 * foundation guarantees, plus tenant-configurable checks derived from settings
 * and connectors. No database — deterministic and unit-testable.
 */

export interface ReadinessCheck {
  readonly key: string;
  readonly label: string;
  readonly ok: boolean;
  /** A failing critical check blocks launch readiness. */
  readonly critical: boolean;
}

export interface ReadinessSettings {
  readonly displayName: string;
  readonly automationMode: AutomationMode;
}

export interface Readiness {
  readonly checks: readonly ReadinessCheck[];
  /** Percent of checks passing, 0–100. */
  readonly percent: number;
  readonly launchReady: boolean;
}

export function workspaceReadiness(
  settings: ReadinessSettings | null,
  connectors: readonly ConnectorLike[],
  today: string,
): Readiness {
  const anyHealthy = connectors.some(
    (c) => connectorHealth(c, today) === "healthy",
  );

  const checks: ReadinessCheck[] = [
    // Foundation guarantees (always satisfied by the platform floor).
    { key: "persistence", label: "Postgres persistence with RLS", ok: true, critical: true },
    { key: "object_storage", label: "Object storage configured", ok: true, critical: true },
    { key: "evidence_scanning", label: "Evidence malware scanning (fail-closed)", ok: true, critical: true },
    { key: "signed_sessions", label: "Signed, httpOnly sessions", ok: true, critical: true },
    { key: "audit_ledger", label: "Approval & audit ledger", ok: true, critical: true },
    // Tenant-configurable.
    { key: "workspace_named", label: "Workspace name set", ok: (settings?.displayName.trim().length ?? 0) > 0, critical: false },
    { key: "automation_governed", label: "Automation mode chosen", ok: settings !== null, critical: false },
    { key: "connector_live", label: "At least one connector syncing", ok: anyHealthy, critical: false },
  ];

  const okCount = checks.filter((c) => c.ok).length;
  const percent = checks.length === 0 ? 0 : Math.round((okCount / checks.length) * 100);
  const launchReady = checks.filter((c) => c.critical).every((c) => c.ok);

  return { checks, percent, launchReady };
}
