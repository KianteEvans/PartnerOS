"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { runMutation } from "@/gate/mutation-gate";
import { withTenant } from "@/db/client";
import { awsConnection } from "@/db/schema";
import { getServerIdentity } from "@/auth/session";
import { AppError } from "@/http/errors";
import { type ActionState } from "@/domain/forms";
import { saveAwsConnectionOp, syncMirrorOp, acceptPartnerCentralTruthOp } from "@/domain/aws/operations";
import { syncAwsSalesOrgOp, type SyncedOppTeam } from "@/domain/aws/sales-org";
import { parseBulkIds } from "@/domain/bulk";
import { listPartnerCentralOpportunities, getAwsOpportunityTeams } from "@/aws/partner-central";
import { toMirrorRow, toAwsTeam, engagementScore, nextBestActions, type MirrorRow } from "@/domain/aws/mapping";

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

function field(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Save the per-tenant AWS connection (cross-account IAM role). Gated. */
export async function saveAwsConnection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const roleArn = field(formData.get("roleArn"));
    const externalId = field(formData.get("externalId"));
    const region = field(formData.get("region")) || "us-east-1";
    const catalog = field(formData.get("catalog")) || "Sandbox";
    const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
    const enrichTeam = formData.get("enrichTeam") === "on" || formData.get("enrichTeam") === "true";
    await runMutation({
      permission: "settings:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      // The external id is a shared secret — log only its length, never the value.
      rawBody: JSON.stringify({ roleArn, region, catalog, enabled, enrichTeam, externalIdLen: externalId.length }),
      action: "settings.save_aws_connection",
      resourceType: "aws_connection",
      auditMetadata: { enabled, region, catalog, enrichTeam },
      handler: (ctx) => saveAwsConnectionOp(ctx, { roleArn, externalId, region, catalog, enabled, enrichTeam }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Read-only sync: assume the tenant's role, list Partner Central co-sell
 * opportunities (Sandbox catalog), and mirror them. The AWS call runs OUTSIDE any
 * DB transaction; the mirror write goes through the gate (audit + RLS). Re-sync
 * is allowed (the mirror upserts by external id).
 */
export async function syncPartnerCentral(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identity = await getServerIdentity().catch(() => null);
  if (!identity) return { ok: false, error: "Sign in to sync." };

  const [cfg] = await withTenant(identity, (tx) =>
    tx.select().from(awsConnection).where(eq(awsConnection.tenantId, identity.tenantId)),
  );
  if (!cfg || !cfg.enabled) {
    return { ok: false, error: "Configure and enable the AWS connection in Settings → Integrations first." };
  }

  let rows: MirrorRow[];
  try {
    const summaries = await listPartnerCentralOpportunities({
      tenantId: identity.tenantId,
      roleArn: cfg.roleArn,
      externalId: cfg.externalId,
      region: cfg.region,
      catalog: cfg.catalog,
    });
    rows = summaries.map(toMirrorRow).filter((r): r is MirrorRow => r !== null);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "Unknown error";
    await withTenant(identity, (tx) =>
      tx
        .update(awsConnection)
        .set({ status: "error", lastError: message, updatedAt: sql`now()` })
        .where(eq(awsConnection.tenantId, identity.tenantId)),
    ).catch(() => undefined);
    return { ok: false, error: "AWS sync failed — check the connection details and try again." };
  }

  try {
    await runMutation({
      permission: "ace:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ count: rows.length }),
      action: "ace.partner_central_sync",
      resourceType: "aws_connection",
      auditMetadata: { count: rows.length, catalog: cfg.catalog },
      handler: (ctx) => syncMirrorOp(ctx, rows),
    });
  } catch (err) {
    return failure(err);
  }

  // Optional: enrich AWS-referred opps with their AWS team (one GetAwsOpportunitySummary
  // per opp). Error-tolerant — a team-fetch failure must never undo the mirror sync.
  if (cfg.enrichTeam && rows.length > 0) {
    try {
      const teams = await getAwsOpportunityTeams(
        {
          tenantId: identity.tenantId,
          roleArn: cfg.roleArn,
          externalId: cfg.externalId,
          region: cfg.region,
          catalog: cfg.catalog,
        },
        rows.map((r) => r.externalId),
      );
      const teamed: SyncedOppTeam[] = [];
      for (const mirror of rows) {
        const summary = teams.get(mirror.externalId);
        if (!summary) continue;
        const team = toAwsTeam(summary);
        if (team.length === 0) continue; // only promote opps that carry an AWS team
        teamed.push({
          externalId: mirror.externalId,
          mirror,
          team,
          engagementScore: engagementScore(summary),
          nextBestActions: nextBestActions(summary),
        });
      }
      if (teamed.length > 0) {
        await runMutation({
          permission: "ace:update",
          idempotencyKey: `ace-sales-org:${identity.tenantId}:${String(formData.get("idempotencyKey") ?? "")}`,
          rawBody: JSON.stringify({ opps: teamed.length }),
          action: "ace.aws_sales_org_sync",
          resourceType: "aws_connection",
          auditMetadata: { opps: teamed.length },
          handler: (ctx) => syncAwsSalesOrgOp(ctx, teamed),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 300) : "Unknown error";
      await withTenant(identity, (tx) =>
        tx
          .update(awsConnection)
          .set({ lastError: message, updatedAt: sql`now()` })
          .where(eq(awsConnection.tenantId, identity.tenantId)),
      ).catch(() => undefined);
      // Swallow — the mirror sync already committed; surface the error via lastError only.
    }
  }

  revalidatePath("/ace");
  return { ok: true };
}

/**
 * "Accept AWS as truth" — overwrite the selected local opportunities with their
 * read-only Partner Central mirror values (stage/status/amount/name). Gated on
 * `ace:update`; the op is tenant-scoped and only touches opps with a matching mirror
 * row, so manual/partner-originated deals are never affected. Shared by the single-row
 * and bulk ("Accept all AWS changes") reconcile controls.
 */
async function runAcceptTruth(ids: string[], idempotencyKey: string): Promise<{ count: number }> {
  const res = await runMutation({
    permission: "ace:update",
    idempotencyKey,
    rawBody: JSON.stringify({ count: ids.length }),
    action: "ace.accept_partner_central_truth",
    resourceType: "opportunity",
    auditMetadata: { count: ids.length },
    handler: (ctx) => acceptPartnerCentralTruthOp(ctx, { ids }),
  });
  return res.body;
}

export async function acceptPartnerCentralTruth(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const id = String(formData.get("id") ?? "");
    const { count } = await runAcceptTruth(id ? [id] : [], String(formData.get("idempotencyKey") ?? ""));
    revalidatePath("/ace");
    return { ok: true, detail: count > 0 ? "Accepted the AWS values for this opportunity." : "No change — already matches AWS." };
  } catch (err) {
    return failure(err);
  }
}

export async function bulkAcceptPartnerCentralTruth(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ids = parseBulkIds(formData.get("ids"));
    const { count } = await runAcceptTruth(ids, String(formData.get("idempotencyKey") ?? ""));
    revalidatePath("/ace");
    return { ok: true, detail: `Accepted AWS values for ${count} opportunit${count === 1 ? "y" : "ies"}.` };
  } catch (err) {
    return failure(err);
  }
}
