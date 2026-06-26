import { addDays } from "@/domain/dates";

/**
 * Pure ACE relationship intelligence: strength banding, stale-contact warnings,
 * and account coverage. No database, no clock — deterministic and unit-testable.
 */

export type RelationshipRole =
  | "seller"
  | "solutions_architect"
  | "partner_manager"
  | "leadership"
  | "other";

export const ROLE_LABELS: Record<RelationshipRole, string> = {
  seller: "Seller",
  solutions_architect: "Solutions Architect",
  partner_manager: "Partner Manager",
  leadership: "Leadership",
  other: "Other",
};

export const CONTACT_STALE_DAYS = 60;

export type StrengthBand = "strong" | "developing" | "weak";

export const STRENGTH_BAND_LABELS: Record<StrengthBand, string> = {
  strong: "Strong",
  developing: "Developing",
  weak: "Weak",
};

export function strengthBand(strength: number): StrengthBand {
  if (strength >= 70) return "strong";
  if (strength >= 40) return "developing";
  return "weak";
}

export interface RelationshipLike {
  readonly accountName: string;
  readonly strength: number;
  readonly lastContact: string | null;
}

/** No contact recorded, or none within the window. */
export function isStaleContact(rel: RelationshipLike, today: string): boolean {
  if (rel.lastContact === null) return true;
  return rel.lastContact < addDays(today, -CONTACT_STALE_DAYS);
}

export interface AccountCoverage {
  readonly account: string;
  readonly contacts: number;
  readonly maxStrength: number;
  readonly hasStrong: boolean;
}

/** Coverage per account: how many contacts and the best relationship strength. */
export function coverageByAccount(
  rels: readonly RelationshipLike[],
): AccountCoverage[] {
  const byAccount = new Map<string, { contacts: number; maxStrength: number }>();
  for (const r of rels) {
    const key = r.accountName || "(unspecified)";
    const cur = byAccount.get(key) ?? { contacts: 0, maxStrength: 0 };
    byAccount.set(key, {
      contacts: cur.contacts + 1,
      maxStrength: Math.max(cur.maxStrength, r.strength),
    });
  }
  return [...byAccount.entries()]
    .map(([account, v]) => ({
      account,
      contacts: v.contacts,
      maxStrength: v.maxStrength,
      hasStrong: v.maxStrength >= 70,
    }))
    .sort((a, b) => a.account.localeCompare(b.account));
}
