import { addDays } from "@/domain/dates";

/**
 * Pure connector intelligence: the integration catalog and per-connector health
 * derived from status + freshness. No database, no clock — the caller passes
 * `today`. Deterministic and unit-testable.
 */

export type ConnectorKind =
  | "ace"
  | "salesforce"
  | "marketplace"
  | "aws_context"
  | "mdf_import"
  | "csv"
  | "notetaker";

export type ConnectorStatus = "not_configured" | "configured" | "disabled" | "error";

export interface ConnectorMeta {
  readonly kind: ConnectorKind;
  readonly label: string;
  readonly description: string;
}

/** The catalog of integrations PartnerOS can register. */
export const CONNECTOR_CATALOG: readonly ConnectorMeta[] = [
  { kind: "ace", label: "AWS ACE", description: "Co-sell relationships and opportunities." },
  { kind: "salesforce", label: "Salesforce", description: "CRM accounts and opportunities." },
  { kind: "marketplace", label: "AWS Marketplace", description: "Listings, offers, and billing signals." },
  { kind: "aws_context", label: "AWS Context Connector", description: "Documentation-only, read-only AWS context." },
  { kind: "mdf_import", label: "MDF / APFP import", description: "Funding requests and reconciliation." },
  { kind: "csv", label: "CSV import", description: "Manual spreadsheet imports." },
  { kind: "notetaker", label: "Meeting notetaker", description: "Optional meeting and call notes." },
];

export const CONNECTOR_LABELS: Record<ConnectorKind, string> = Object.fromEntries(
  CONNECTOR_CATALOG.map((c) => [c.kind, c.label]),
) as Record<ConnectorKind, string>;

/** Days since last sync after which a configured connector is "stale". */
export const SYNC_STALE_DAYS = 7;

export type ConnectorHealth = "unconfigured" | "disabled" | "error" | "stale" | "healthy";

export const HEALTH_LABELS: Record<ConnectorHealth, string> = {
  unconfigured: "Not configured",
  disabled: "Disabled",
  error: "Error",
  stale: "Stale",
  healthy: "Healthy",
};

export interface ConnectorLike {
  readonly status: ConnectorStatus;
  /** ISO date of the last successful sync (YYYY-MM-DD), or null. */
  readonly lastSyncDate: string | null;
}

export function connectorHealth(c: ConnectorLike, today: string): ConnectorHealth {
  if (c.status === "not_configured") return "unconfigured";
  if (c.status === "disabled") return "disabled";
  if (c.status === "error") return "error";
  // configured:
  if (c.lastSyncDate === null) return "stale";
  return c.lastSyncDate >= addDays(today, -SYNC_STALE_DAYS) ? "healthy" : "stale";
}
