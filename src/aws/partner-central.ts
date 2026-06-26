import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  PartnerCentralSellingClient,
  ListOpportunitiesCommand,
  GetAwsOpportunitySummaryCommand,
  type OpportunitySummary,
} from "@aws-sdk/client-partnercentral-selling";
import type { AwsOpportunitySummaryResult } from "@/domain/aws/mapping";

/**
 * Server-only AWS Partner Central client. The app assumes the tenant's cross-account
 * IAM role (sts:AssumeRole with the external id; the app's OWN credentials come from
 * the ambient AWS provider chain — env / shared config / instance role) to get
 * short-lived credentials, then lists co-sell opportunities from the requested
 * catalog ("Sandbox" by default). Never imported by client code. Nothing long-lived
 * is stored — only the role ARN + external id live in the DB.
 */

export interface AwsConnectionConfig {
  readonly tenantId: string;
  readonly roleArn: string;
  readonly externalId: string;
  readonly region: string;
  readonly catalog: string; // "Sandbox" | "AWS"
}

const MAX_PAGES = 10; // safety bound on pagination
const TEAM_CONCURRENCY = 4; // parallel GetAwsOpportunitySummary calls
const TEAM_MAX_OPPS = 200; // ceiling on per-opp GETs per sync (= MAX_PAGES x MaxResults)

async function assumeTenantRole(cfg: AwsConnectionConfig): Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}> {
  const sts = new STSClient({ region: cfg.region });
  const res = await sts.send(
    new AssumeRoleCommand({
      RoleArn: cfg.roleArn,
      ExternalId: cfg.externalId,
      RoleSessionName: `partneros-${cfg.tenantId}`.slice(0, 64),
      DurationSeconds: 900,
    }),
  );
  const c = res.Credentials;
  if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
    throw new Error("AssumeRole returned no credentials");
  }
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
  };
}

/** List Partner Central co-sell opportunity summaries for the tenant (paginated). */
export async function listPartnerCentralOpportunities(
  cfg: AwsConnectionConfig,
): Promise<OpportunitySummary[]> {
  const credentials = await assumeTenantRole(cfg);
  const client = new PartnerCentralSellingClient({ region: cfg.region, credentials });

  const summaries: OpportunitySummary[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await client.send(
      new ListOpportunitiesCommand({
        Catalog: cfg.catalog,
        MaxResults: 20,
        NextToken: nextToken,
      }),
    );
    summaries.push(...(res.OpportunitySummaries ?? []));
    nextToken = res.NextToken;
    if (!nextToken) break;
  }
  return summaries;
}

/**
 * Fetch the AWS team (OpportunityTeam) for each AWS-referred opportunity via
 * GetAwsOpportunitySummary. One assume-role, then a bounded-concurrency fan-out of
 * N GETs on a single client. Each GET is isolated: an absent team (the common case on
 * partner-originated opps), a 404, AccessDenied, or a throttle is swallowed so a single
 * opportunity never fails the whole sync. Capped at TEAM_MAX_OPPS. Requires the IAM
 * action `partnercentral:GetAwsOpportunitySummary` on the tenant role.
 */
export async function getAwsOpportunityTeams(
  cfg: AwsConnectionConfig,
  externalIds: readonly string[],
): Promise<Map<string, AwsOpportunitySummaryResult>> {
  const ids = [...new Set(externalIds.filter((id) => id))].slice(0, TEAM_MAX_OPPS);
  const out = new Map<string, AwsOpportunitySummaryResult>();
  if (ids.length === 0) return out;

  const credentials = await assumeTenantRole(cfg);
  const client = new PartnerCentralSellingClient({ region: cfg.region, credentials });

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < ids.length) {
      const id = ids[cursor++]!;
      try {
        const res = await client.send(
          new GetAwsOpportunitySummaryCommand({ Catalog: cfg.catalog, RelatedOpportunityIdentifier: id }),
        );
        out.set(id, res as AwsOpportunitySummaryResult);
      } catch {
        // Skip this opportunity (no team / not found / not permitted / throttled).
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(TEAM_CONCURRENCY, ids.length) }, () => worker()),
  );
  return out;
}
