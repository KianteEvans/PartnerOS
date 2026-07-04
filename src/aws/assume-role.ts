import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

/**
 * Shared STS assume-role helper for every per-tenant AWS connector (Partner Central,
 * Marketplace, ...). The app assumes the tenant's cross-account IAM role
 * (sts:AssumeRole with the external id; the app's OWN credentials come from the ambient
 * AWS provider chain -- env / shared config / instance role) to get short-lived
 * credentials. Server-only. Nothing long-lived is stored; only the role ARN + external
 * id live in the DB.
 */

export interface AwsRoleConfig {
  readonly tenantId: string;
  readonly roleArn: string;
  readonly externalId: string;
  readonly region: string;
}

export interface ShortLivedCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken: string;
}

export async function assumeTenantRole(cfg: AwsRoleConfig): Promise<ShortLivedCredentials> {
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
