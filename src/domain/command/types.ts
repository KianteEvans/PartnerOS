import type { MdfLike } from "@/domain/mdf/analytics";
import type { OppLike } from "@/domain/ace/opportunities";
import type { RepRelationship } from "@/domain/ace/rep-intelligence";
import type { EvidenceLike } from "@/domain/evidence/inventory";
import type { RequirementValue } from "@/domain/tiers/gap";

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
}
