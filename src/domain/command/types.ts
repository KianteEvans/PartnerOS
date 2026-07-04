import type { MdfLike } from "@/domain/mdf/analytics";
import type { OppLike } from "@/domain/ace/opportunities";
import type { RepRelationship } from "@/domain/ace/rep-intelligence";
import type { EvidenceLike } from "@/domain/evidence/inventory";
import type { RequirementValue } from "@/domain/tiers/gap";
import type { AwsSyncInput } from "@/domain/aws/signals";
import type { RematchCandidate } from "@/domain/funding/rematch";

/**
 * Shared input shapes for the Command Center aggregation. The domain *Like types
 * are extended with the id/title fields a decision link needs. These are plain
 * data — the pure derivation functions in health.ts/brief.ts/aggregate.ts take
 * them and never touch the database.
 */

export interface CommandTask {
  readonly id: string;
  readonly title: string;
  readonly status: "open" | "in_progress" | "blocked" | "done";
  readonly priority: "low" | "medium" | "high" | "critical";
  readonly ownerUserId: string | null;
  readonly dueDate: string | null;
}

export interface CommandMdf extends MdfLike {
  readonly id: string;
  readonly title: string;
}

export interface CommandOpp extends OppLike {
  readonly id: string;
  readonly name: string;
  readonly accountName: string;
  readonly awsContactId: string | null;
}

export interface CommandProgram {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly expirationDate: string | null;
}

export interface CommandEvidence extends EvidenceLike {
  readonly id: string;
  readonly title: string;
}

export interface CommandTier {
  readonly currentTier: string;
  readonly targetTier: string;
  readonly status: string;
}

export interface CommandMilestone {
  readonly id: string;
  readonly roadmapId: string;
  readonly title: string;
  readonly status: "planned" | "in_progress" | "done" | "blocked";
  readonly targetDate: string;
  readonly ownerUserId: string | null;
}

export interface CommandSolution {
  readonly id: string;
  readonly title: string;
  readonly availability: string;
  readonly programType: string;
  readonly solutionType: string;
  readonly ftrStatus: string;
  /** Launched ACE opportunities attached over the rolling 12 months. */
  readonly launchedCount: number;
  readonly renewalDate: string | null;
}

export interface CommandPlanEvent {
  readonly id: string;
  readonly planId: string;
  readonly title: string;
  /** Derived AWS fund-request submit-by deadline (null when undated). */
  readonly submitBy: string | null;
  /** Already converted into a request (no longer needs a fund request). */
  readonly converted: boolean;
  readonly ownerUserId: string | null;
}

/** Per-listing AWS Marketplace rollup for the cross-section "needs attention" signals. */
export interface CommandMarketplaceListing {
  readonly id: string;
  readonly title: string;
  readonly published: boolean;
  /** Active customer entitlements expiring within 30 days. */
  readonly expiringEntitlements: number;
  readonly expiredEntitlements: number;
  /** AWS Catalog change sets in a failed terminal state. */
  readonly failedChangeSets: number;
  /** Accepted BatchMeterUsage records (0 on a published listing => a metering gap). */
  readonly acceptedUsageCount: number;
  readonly attributedRevenueCents: number;
}

export interface CommandInputs {
  readonly tasks: readonly CommandTask[];
  readonly mdf: readonly CommandMdf[];
  readonly opportunities: readonly CommandOpp[];
  readonly programs: readonly CommandProgram[];
  readonly evidence: readonly CommandEvidence[];
  readonly tier: CommandTier | null;
  readonly tierRequirements: readonly RequirementValue[];
  readonly relationships: readonly RepRelationship[];
  /** Milestones on finalized roadmaps (committed plans), for overdue signals. */
  readonly milestones: readonly CommandMilestone[];
  /** Specialization Solutions, for renewal-readiness signals. */
  readonly solutions: readonly CommandSolution[];
  /** Tenant partner tier (renewal-readiness reads it per Solution). */
  readonly currentTier: string;
  /** Planned events awaiting a fund request, for submit-by deadline signals. */
  readonly planEvents?: readonly CommandPlanEvent[] | undefined;
  /** Per-listing AWS Marketplace rollups, for entitlement / change-set / revenue-gap signals. */
  readonly marketplace?: readonly CommandMarketplaceListing[] | undefined;
  /** Partner Central connection freshness + opportunity drift, for sync-health signals. */
  readonly awsSync?: AwsSyncInput | undefined;
  /** Open AWS funding submissions, for response-deadline signals. */
  readonly fundingSubmissions?: readonly CommandFundingSubmission[] | undefined;
  /** Open deals eligible for un-applied AWS funding, for the proactive re-match signal. */
  readonly fundingRematch?: readonly RematchCandidate[] | undefined;
}

/** An open AWS funding submission, for the Command Center response-deadline signal. */
export interface CommandFundingSubmission {
  readonly id: string;
  readonly title: string;
  /** Non-terminal (not funded/rejected/withdrawn). */
  readonly open: boolean;
  readonly deadline: string | null;
  readonly ownerUserId: string | null;
}
