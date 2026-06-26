import { and, eq, isNull, sql } from "drizzle-orm";
import { opportunities, aceRelationships, opportunityAwsTeam } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import type { MirrorRow, AwsContactUpsert } from "@/domain/aws/mapping";

/**
 * DB side of the AWS Sales-Org sync. Promotes AWS-referred opportunities that carry a
 * resolvable AWS team into the editable `opportunities` table (deduped by external_id),
 * upserts each AWS team member into `ace_relationships` (deduped by email), links them
 * via the `opportunity_aws_team` junction with their AWS title, and points the
 * opportunity's primary `awsContactId` at the Sales Rep. Idempotent + tenant-scoped;
 * re-sync never clobbers user-owned columns (owner/routing/nextStep/solution/contact).
 * The AWS API calls happen in the action — this is DB-only, inside the gate tx.
 */

export interface SyncedOppTeam {
  readonly externalId: string;
  readonly mirror: MirrorRow;
  readonly team: readonly AwsContactUpsert[]; // already deduped (non-empty)
  readonly engagementScore: string;
  readonly nextBestActions: string;
}

/** The Sales Rep is the natural primary contact; fall back to Account Owner, then any. */
function primaryEmail(team: readonly AwsContactUpsert[]): string | undefined {
  return (
    team.find((c) => c.title === "aws_sales_rep")?.email ??
    team.find((c) => c.title === "aws_account_owner")?.email ??
    team[0]?.email
  );
}

export async function syncAwsSalesOrgOp(
  { identity, tx }: MutationContext,
  rows: readonly SyncedOppTeam[],
): Promise<{ opportunities: number; contacts: number }> {
  const t = identity.tenantId;
  let contactCount = 0;

  for (const r of rows) {
    // 1. Upsert the opportunity by (tenant, external_id). On re-sync update ONLY the
    //    AWS-sourced columns — never owner/routing/nextStep/solution/awsContact/task.
    const [opp] = await tx
      .insert(opportunities)
      .values({
        tenantId: t,
        name: r.mirror.name,
        accountName: r.mirror.accountName,
        stage: r.mirror.stage,
        status: r.mirror.status,
        amount: r.mirror.amount,
        source: "amazon_originated",
        externalId: r.externalId,
        awsEngagementScore: r.engagementScore,
        awsNextBestActions: r.nextBestActions,
        routingStatus: "unrouted",
        createdBy: identity.userId,
      })
      .onConflictDoUpdate({
        target: [opportunities.tenantId, opportunities.externalId],
        targetWhere: sql`${opportunities.externalId} is not null`,
        set: {
          name: r.mirror.name,
          accountName: r.mirror.accountName,
          stage: r.mirror.stage,
          status: r.mirror.status,
          amount: r.mirror.amount,
          awsEngagementScore: r.engagementScore,
          awsNextBestActions: r.nextBestActions,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: opportunities.id });
    const oppId = opp!.id;

    // 2. Upsert each AWS team member into ace_relationships, deduped by lower(email).
    const emailToRel = new Map<string, string>();
    for (const c of r.team) {
      const [existing] = await tx
        .select({ id: aceRelationships.id, accountName: aceRelationships.accountName })
        .from(aceRelationships)
        .where(and(eq(aceRelationships.tenantId, t), sql`lower(${aceRelationships.email}) = ${c.email}`));
      if (existing) {
        await tx
          .update(aceRelationships)
          .set({
            name: c.name,
            // Backfill the account only if we never recorded one (don't overwrite manual edits).
            accountName: existing.accountName === "" ? r.mirror.accountName : existing.accountName,
            updatedAt: sql`now()`,
          })
          .where(and(eq(aceRelationships.id, existing.id), eq(aceRelationships.tenantId, t)));
        emailToRel.set(c.email, existing.id);
      } else {
        const [ins] = await tx
          .insert(aceRelationships)
          .values({
            tenantId: t,
            name: c.name,
            role: c.role,
            email: c.email,
            accountName: r.mirror.accountName,
            strength: 0,
            createdBy: identity.userId,
          })
          .returning({ id: aceRelationships.id });
        emailToRel.set(c.email, ins!.id);
      }
      contactCount += 1;
    }

    // 3. Point the opportunity's primary AWS contact at the Sales Rep — only if unset
    //    (never overwrite a manual link).
    const pe = primaryEmail(r.team);
    const primaryRel = pe ? emailToRel.get(pe) : undefined;
    if (primaryRel) {
      await tx
        .update(opportunities)
        .set({ awsContactId: primaryRel, updatedAt: sql`now()` })
        .where(
          and(
            eq(opportunities.id, oppId),
            eq(opportunities.tenantId, t),
            isNull(opportunities.awsContactId),
          ),
        );
    }

    // 4. Rebuild the junction for this opp (delete-all-then-insert = idempotent, drops
    //    members no longer on the deal).
    await tx
      .delete(opportunityAwsTeam)
      .where(and(eq(opportunityAwsTeam.tenantId, t), eq(opportunityAwsTeam.opportunityId, oppId)));
    const edges = r.team
      .map((c) => ({ email: c.email, title: c.title, relationshipId: emailToRel.get(c.email) }))
      .filter((e): e is { email: string; title: AwsContactUpsert["title"]; relationshipId: string } =>
        Boolean(e.relationshipId),
      )
      .map((e) => ({ tenantId: t, opportunityId: oppId, relationshipId: e.relationshipId, title: e.title }));
    if (edges.length > 0) await tx.insert(opportunityAwsTeam).values(edges);
  }

  return { opportunities: rows.length, contacts: contactCount };
}
