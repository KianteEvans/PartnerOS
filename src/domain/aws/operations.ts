import { eq, sql } from "drizzle-orm";
import type { MutationContext } from "@/gate/mutation-gate";
import { awsConnection, partnerCentralOpportunities } from "@/db/schema";
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
