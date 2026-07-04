import { and, eq, inArray, sql } from "drizzle-orm";
import type { MutationContext } from "@/gate/mutation-gate";
import { awsConnection, opportunities, partnerCentralOpportunities } from "@/db/schema";
import { ValidationError } from "@/http/errors";
import type { MirrorRow } from "@/domain/aws/mapping";

const ROLE_ARN_RE = /^arn:aws:iam::\d{12}:role\/.+$/;
const CATALOGS = new Set(["Sandbox", "AWS"]);

export interface AwsConnectionInput {
  readonly roleArn: string;
  readonly externalId: string;
  readonly region: string;
  readonly catalog: string;
  readonly enabled: boolean;
  readonly enrichTeam: boolean;
}

/** Validate + upsert the per-tenant AWS connection (gated; SAML-config pattern). */
export async function saveAwsConnectionOp(
  { identity, tx }: MutationContext,
  input: AwsConnectionInput,
): Promise<{ id: string }> {
  if (!CATALOGS.has(input.catalog)) {
    throw new ValidationError("Catalog must be Sandbox or AWS.");
  }
  if (input.enabled) {
    if (!ROLE_ARN_RE.test(input.roleArn)) {
      throw new ValidationError("Enter a valid IAM role ARN (arn:aws:iam::<account-id>:role/<name>).");
    }
    if (!input.externalId.trim()) {
      throw new ValidationError("An external ID is required to enable the connection.");
    }
  }

  const region = input.region || "us-east-1";
  const status = input.enabled ? "configured" : "disabled";
  await tx
    .insert(awsConnection)
    .values({
      tenantId: identity.tenantId,
      roleArn: input.roleArn,
      externalId: input.externalId,
      region,
      catalog: input.catalog,
      enabled: input.enabled,
      enrichTeam: input.enrichTeam,
      status,
    })
    .onConflictDoUpdate({
      target: awsConnection.tenantId,
      set: {
        roleArn: input.roleArn,
        externalId: input.externalId,
        region,
        catalog: input.catalog,
        enabled: input.enabled,
        enrichTeam: input.enrichTeam,
        status,
        updatedAt: sql`now()`,
      },
    });
  return { id: identity.tenantId };
}

/**
 * Upsert the read-only mirror rows by (tenant, external id) — re-sync updates in
 * place, never duplicates — then stamp the connection's last sync. DB-only: the
 * AWS call happens in the action, outside this transaction.
 */
export async function syncMirrorOp(
  { identity, tx }: MutationContext,
  rows: readonly MirrorRow[],
): Promise<{ count: number }> {
  for (const r of rows) {
    await tx
      .insert(partnerCentralOpportunities)
      .values({
        tenantId: identity.tenantId,
        externalId: r.externalId,
        name: r.name,
        accountName: r.accountName,
        stage: r.stage,
        status: r.status,
        amount: r.amount,
        awsStageRaw: r.awsStageRaw,
        syncedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [partnerCentralOpportunities.tenantId, partnerCentralOpportunities.externalId],
        set: {
          name: r.name,
          accountName: r.accountName,
          stage: r.stage,
          status: r.status,
          amount: r.amount,
          awsStageRaw: r.awsStageRaw,
          syncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });
  }
  await tx
    .update(awsConnection)
    .set({ status: "configured", lastSyncedAt: sql`now()`, lastError: null, updatedAt: sql`now()` })
    .where(eq(awsConnection.tenantId, identity.tenantId));
  return { count: rows.length };
}

export interface AcceptTruthInput {
  /** Local opportunity ids whose values should be overwritten by their AWS mirror. */
  readonly ids: readonly string[];
}

/**
 * "Accept AWS as truth": copy the read-only Partner Central mirror values onto the
 * matching local opportunities (the editable source of record). One correlated,
 * tenant-guarded UPDATE ... FROM — a local opp is only touched when it (a) is in the
 * id list, (b) belongs to the tenant, and (c) has a mirror row sharing its external
 * id. Manual opps (null external_id) never match, so partner-originated deals can't
 * be clobbered. Fields mirror 1:1 (shared enums); source / owner / dates are left
 * alone. Returns the number of rows updated.
 */
export async function acceptPartnerCentralTruthOp(
  { identity, tx }: MutationContext,
  input: AcceptTruthInput,
): Promise<{ count: number }> {
  if (input.ids.length === 0) {
    throw new ValidationError("Select at least one opportunity to reconcile.");
  }
  const updated = await tx
    .update(opportunities)
    .set({
      name: sql`${partnerCentralOpportunities.name}`,
      accountName: sql`${partnerCentralOpportunities.accountName}`,
      stage: sql`${partnerCentralOpportunities.stage}`,
      status: sql`${partnerCentralOpportunities.status}`,
      amount: sql`${partnerCentralOpportunities.amount}`,
      updatedAt: sql`now()`,
    })
    .from(partnerCentralOpportunities)
    .where(
      and(
        inArray(opportunities.id, [...input.ids]),
        eq(opportunities.tenantId, identity.tenantId),
        eq(partnerCentralOpportunities.tenantId, identity.tenantId),
        eq(partnerCentralOpportunities.externalId, opportunities.externalId),
      ),
    )
    .returning({ id: opportunities.id });
  return { count: updated.length };
}
