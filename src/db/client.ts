import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "@/db/schema";

/**
 * Tenant isolation is enforced by PostgreSQL Row-Level Security (Rule 2), not by
 * app-code filtering. This module provides the ONLY sanctioned ways to run
 * queries:
 *
 *   withTenant(identity, fn)  -> runs fn inside a transaction that has assumed
 *                                the non-privileged `partneros_app` role and set
 *                                app.tenant_id / app.user_id / app.role. RLS
 *                                policies key off those settings, so a query
 *                                that forgets to filter still returns zero rows
 *                                from other tenants.
 *
 *   withSystem(fn)            -> runs fn as the table owner WITHOUT RLS. Reserved
 *                                for migrations and pre-identity provisioning
 *                                (tenant/user creation during OIDC callback).
 *                                Never call this from request handlers.
 */

export type TenantDb = PostgresJsDatabase<typeof schema>;

export interface DbIdentity {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
}

// Role the app assumes for every tenant-scoped statement. It must NOT own the
// tables and must NOT have BYPASSRLS, so RLS is always evaluated.
const APP_ROLE = "partneros_app";

let _sql: ReturnType<typeof postgres> | null = null;
let _db: TenantDb | null = null;

function getClient(): { sqlClient: ReturnType<typeof postgres>; db: TenantDb } {
  if (_sql && _db) return { sqlClient: _sql, db: _db };
  _sql = postgres(env.DATABASE_URL, {
    max: 10,
    prepare: false,
    onnotice: () => {},
  });
  _db = drizzle(_sql, { schema });
  return { sqlClient: _sql, db: _db };
}

/**
 * Run a callback inside a tenant-scoped transaction. All identity values come
 * from the verified session (Rule 4) — never from request arguments.
 */
export async function withTenant<T>(
  identity: DbIdentity,
  fn: (tx: TenantDb) => Promise<T>,
): Promise<T> {
  const { db } = getClient();
  return db.transaction(async (tx) => {
    // Drop into the restricted role for the life of the transaction. Even if the
    // base connection is a superuser (as with embedded Postgres in tests), RLS
    // is enforced against this assumed role.
    await tx.execute(sql.raw(`set local role ${APP_ROLE}`));
    // set_config(name, value, is_local=true) is transaction-scoped and safely
    // parameterized (unlike SET LOCAL, which cannot bind values).
    await tx.execute(
      sql`select set_config('app.tenant_id', ${identity.tenantId}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.user_id', ${identity.userId}, true)`,
    );
    await tx.execute(sql`select set_config('app.role', ${identity.role}, true)`);
    return fn(tx as unknown as TenantDb);
  });
}

/**
 * Privileged, RLS-bypassing access for migrations and pre-identity provisioning
 * ONLY. Intentionally not exported from the db barrel for general use.
 */
export async function withSystem<T>(
  fn: (tx: TenantDb) => Promise<T>,
): Promise<T> {
  const { db } = getClient();
  return db.transaction(async (tx) => fn(tx as unknown as TenantDb));
}

/** Close pooled connections (tests / graceful shutdown). */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
    _db = null;
  }
}

export { schema };
