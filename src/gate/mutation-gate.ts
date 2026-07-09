import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { TenantDb } from "@/db/client";
import { idempotencyKeys, auditLog } from "@/db/schema";
import { getServerIdentity } from "@/auth/session";
import type { ServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import type { Permission } from "@/authz/permissions";
import { mutationRateLimiter } from "@/redis/ratelimit";
import type { RateLimiter } from "@/redis/ratelimit";
import {
  AppError,
  IdempotencyConflictError,
  PayloadTooLargeError,
  RateLimitedError,
} from "@/http/errors";
import { log } from "@/observability/logger";

/**
 * THE single gate every mutation passes through (Rule 6). In one place it
 * enforces, in order:
 *
 *   1. server-derived identity (Rule 4) — never from request args
 *   2. authz permission check
 *   3. body-size limit
 *   4. rate limit (per tenant+user)
 *   5. idempotency (replay completed responses; reject conflicting reuse)
 *   6. the handler, inside a tenant-scoped (RLS) transaction
 *   7. an append-only audit_log row, in the same transaction
 *
 * If any check fails the handler never runs. The audit row commits atomically
 * with the mutation, so there is no "did it happen?" ambiguity.
 */

const DEFAULT_MAX_BODY_BYTES = 1_000_000; // 1 MB

export interface MutationContext {
  /** Verified, server-derived identity. */
  readonly identity: ServerIdentity;
  /** Tenant-scoped (RLS-enforced) transaction handle. */
  readonly tx: TenantDb;
}

export interface MutationResult<T> {
  readonly status: number;
  readonly body: T;
  /** True when returned from the idempotency ledger rather than re-executed. */
  readonly replayed: boolean;
}

export interface MutationSpec<T> {
  /** Required permission for this mutation. */
  readonly permission: Permission;
  /** Idempotency key from the client (e.g. Idempotency-Key header). */
  readonly idempotencyKey: string;
  /** The raw request body, used for size enforcement and hashing. */
  readonly rawBody: string | Uint8Array;
  /** Audit fields. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: (result: T) => string | null;
  readonly auditMetadata?: Record<string, unknown>;
  /** The work to perform. Must return JSON-serializable data. */
  readonly handler: (ctx: MutationContext) => Promise<T>;
  readonly maxBodyBytes?: number;
}

export interface GateDeps {
  /** Defaults to the verified session. Override only in tests. */
  readonly resolveIdentity?: () => Promise<ServerIdentity>;
  readonly rateLimiter?: RateLimiter;
}

function byteLength(body: string | Uint8Array): number {
  return typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.byteLength;
}

function hashBody(body: string | Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

export async function runMutation<T>(
  spec: MutationSpec<T>,
  deps: GateDeps = {},
): Promise<MutationResult<T>> {
  // 1. Identity is always server-derived (Rule 4).
  const identity = await (deps.resolveIdentity ?? getServerIdentity)();

  // 2. Authorization.
  requirePermission(identity, spec.permission);

  // 3. Body-size limit.
  const max = spec.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (byteLength(spec.rawBody) > max) {
    throw new PayloadTooLargeError(`Body exceeds ${max} bytes`);
  }

  // 4. Rate limit (per tenant + user).
  const limiter = deps.rateLimiter ?? mutationRateLimiter;
  const rl = await limiter.limit(`${identity.tenantId}:${identity.userId}`);
  if (!rl.success) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    throw new RateLimitedError(retryAfter);
  }

  const requestHash = hashBody(spec.rawBody);

  // 5 + 6 + 7: idempotency, handler, and audit all inside ONE tenant-scoped
  // transaction so RLS applies and the audit row is atomic with the mutation.
  return withTenant(identity, async (tx) => {
    // Claim the idempotency key. ON CONFLICT DO NOTHING lets us detect reuse.
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({
        tenantId: identity.tenantId,
        key: spec.idempotencyKey,
        requestHash,
      })
      .onConflictDoNothing({
        target: [idempotencyKeys.tenantId, idempotencyKeys.key],
      })
      .returning({ id: idempotencyKeys.id });

    if (claimed.length === 0) {
      // Key already exists for this tenant.
      const [existing] = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.tenantId, identity.tenantId),
            eq(idempotencyKeys.key, spec.idempotencyKey),
          ),
        )
        .for("update");

      if (!existing) {
        // Visible only across tenants under RLS — treat as not-ours.
        throw new IdempotencyConflictError();
      }
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyConflictError(
          "Idempotency key reused with a different request body",
        );
      }
      if (existing.completedAt && existing.responseStatus !== null) {
        // Replay the previously committed response.
        return {
          status: existing.responseStatus,
          body: existing.responseBody as T,
          replayed: true,
        };
      }
      // Exists but not completed -> a concurrent request owns it.
      throw new IdempotencyConflictError("Request already in progress");
    }

    // We own the key: run the actual mutation.
    const result = await spec.handler({ identity, tx });

    // Append the audit row in the same transaction (RLS-protected).
    const resourceId = spec.resourceId ? spec.resourceId(result) : null;
    // When an agency operator is acting inside a managed workspace, stamp the
    // agency + real operator into the audit trail for accountability (Bet C).
    const auditMetadata = identity.actingAs
      ? {
          ...(spec.auditMetadata ?? {}),
          actingAsAgency: identity.actingAs.agencyTenantId,
          agencyOperator: identity.actingAs.agencyUserId,
        }
      : (spec.auditMetadata ?? {});
    await tx.insert(auditLog).values({
      tenantId: identity.tenantId,
      actorUserId: identity.userId,
      action: spec.action,
      resourceType: spec.resourceType,
      resourceId,
      metadata: auditMetadata,
    });

    // Persist the response for future replays.
    await tx
      .update(idempotencyKeys)
      .set({
        responseStatus: 200,
        responseBody: result as unknown,
        completedAt: sql`now()`,
      })
      .where(
        and(
          eq(idempotencyKeys.tenantId, identity.tenantId),
          eq(idempotencyKeys.key, spec.idempotencyKey),
        ),
      );

    return { status: 200, body: result, replayed: false };
  }).catch((err: unknown) => {
    // Typed AppErrors are expected control flow (the action layer maps them to
    // form state). Anything else is a real bug: emit one structured error line
    // with enough context to find it, then rethrow unchanged.
    if (!(err instanceof AppError)) {
      log.error("mutation.unhandled", {
        action: spec.action,
        resourceType: spec.resourceType,
        tenantId: identity.tenantId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  });
}
