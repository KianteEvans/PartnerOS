/**
 * Pure per-customer rollup for the Marketplace Customers lens. AWS Marketplace has no single
 * "customer" record with totals — the signals are spread across entitlements, agreements,
 * and metering (all keyed by `customerIdentifier`). This aggregates them into one row per
 * customer, joining `marketplace_customers` for the AWS account id where resolved. No DB, no
 * clock (today is passed for entitlement-expiry) — deterministic and unit-testable.
 */
import { entitlementStatus } from "@/domain/marketplace/entitlements";

export interface CustomerEntitlementRow {
  readonly customerIdentifier: string;
  readonly expirationDate: string | null;
}
export interface CustomerAgreementRow {
  readonly customerIdentifier: string;
  readonly totalValue: number;
}
export interface CustomerMeteringRow {
  readonly customerIdentifier: string;
  readonly quantity: number;
  readonly status: string;
  readonly usageTimestamp: Date;
}
export interface CustomerDirectoryRow {
  readonly customerIdentifier: string;
  readonly customerAwsAccountId: string;
}

export interface CustomerInputs {
  readonly entitlements: readonly CustomerEntitlementRow[];
  readonly agreements: readonly CustomerAgreementRow[];
  readonly metering: readonly CustomerMeteringRow[];
  readonly directory: readonly CustomerDirectoryRow[];
}

export interface CustomerRollup {
  readonly customerIdentifier: string;
  readonly awsAccountId: string;
  readonly entitlements: number;
  readonly activeEntitlements: number;
  readonly agreements: number;
  readonly tcvCents: number;
  readonly acceptedUsage: number;
  readonly lastUsage: Date | null;
}

interface Acc {
  customerIdentifier: string;
  entitlements: number;
  activeEntitlements: number;
  agreements: number;
  tcvCents: number;
  acceptedUsage: number;
  lastUsage: Date | null;
}

/** One record per customer (by `customerIdentifier`), sorted by agreement value desc. */
export function rollupCustomers(inputs: CustomerInputs, today: string): CustomerRollup[] {
  const map = new Map<string, Acc>();
  const acc = (id: string): Acc => {
    let a = map.get(id);
    if (!a) {
      a = {
        customerIdentifier: id,
        entitlements: 0,
        activeEntitlements: 0,
        agreements: 0,
        tcvCents: 0,
        acceptedUsage: 0,
        lastUsage: null,
      };
      map.set(id, a);
    }
    return a;
  };

  for (const e of inputs.entitlements) {
    if (!e.customerIdentifier) continue;
    const a = acc(e.customerIdentifier);
    a.entitlements += 1;
    if (entitlementStatus(e.expirationDate, today) !== "expired") a.activeEntitlements += 1;
  }
  for (const g of inputs.agreements) {
    if (!g.customerIdentifier) continue;
    const a = acc(g.customerIdentifier);
    a.agreements += 1;
    a.tcvCents += g.totalValue;
  }
  for (const m of inputs.metering) {
    if (!m.customerIdentifier || m.status !== "accepted") continue;
    const a = acc(m.customerIdentifier);
    a.acceptedUsage += m.quantity;
    if (a.lastUsage === null || m.usageTimestamp > a.lastUsage) a.lastUsage = m.usageTimestamp;
  }

  const dir = new Map(inputs.directory.map((d) => [d.customerIdentifier, d.customerAwsAccountId] as const));
  return [...map.values()]
    .map((a) => ({ ...a, awsAccountId: dir.get(a.customerIdentifier) ?? "" }))
    .sort((x, y) => y.tcvCents - x.tcvCents || x.customerIdentifier.localeCompare(y.customerIdentifier));
}
