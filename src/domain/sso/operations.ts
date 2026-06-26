import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { TenantDb } from "@/db/client";
import type { MutationContext } from "@/gate/mutation-gate";
import { ssoConfig } from "@/db/schema";
import { ValidationError } from "@/http/errors";
import { hashScimToken } from "@/domain/scim/operations";

/**
 * SCIM config writes. Run inside a withTenant transaction (RLS-scoped), so the
 * upsert's tenant_id must equal the session tenant. Only the token HASH is
 * stored — the plaintext is returned to the caller once and never persisted.
 */

export async function rotateScimTokenWithinTx(
  tx: TenantDb,
  tenantId: string,
): Promise<{ token: string }> {
  const token = `scim_${randomBytes(24).toString("hex")}`;
  const scimTokenHash = hashScimToken(token);
  await tx
    .insert(ssoConfig)
    .values({ tenantId, scimEnabled: true, scimTokenHash })
    .onConflictDoUpdate({
      target: ssoConfig.tenantId,
      set: { scimEnabled: true, scimTokenHash, updatedAt: sql`now()` },
    });
  return { token };
}

export async function setScimEnabledWithinTx(
  tx: TenantDb,
  tenantId: string,
  enabled: boolean,
): Promise<void> {
  await tx
    .insert(ssoConfig)
    .values({ tenantId, scimEnabled: enabled })
    .onConflictDoUpdate({
      target: ssoConfig.tenantId,
      set: { scimEnabled: enabled, updatedAt: sql`now()` },
    });
}

export interface SamlConfigInput {
  readonly enabled: boolean;
  readonly idpEntityId: string | null;
  readonly idpSsoUrl: string | null;
  readonly idpCert: string | null;
}

/** Save a tenant's SAML config (runs through the gate). The cert is public. */
export async function saveSamlConfigOp(
  { identity, tx }: MutationContext,
  input: SamlConfigInput,
): Promise<{ id: string }> {
  if (input.enabled && (!input.idpSsoUrl || !input.idpCert)) {
    throw new ValidationError("An IdP SSO URL and signing certificate are required to enable SAML");
  }
  await tx
    .insert(ssoConfig)
    .values({
      tenantId: identity.tenantId,
      samlEnabled: input.enabled,
      samlIdpEntityId: input.idpEntityId,
      samlIdpSsoUrl: input.idpSsoUrl,
      samlIdpCert: input.idpCert,
    })
    .onConflictDoUpdate({
      target: ssoConfig.tenantId,
      set: {
        samlEnabled: input.enabled,
        samlIdpEntityId: input.idpEntityId,
        samlIdpSsoUrl: input.idpSsoUrl,
        samlIdpCert: input.idpCert,
        updatedAt: sql`now()`,
      },
    });
  return { id: identity.tenantId };
}
