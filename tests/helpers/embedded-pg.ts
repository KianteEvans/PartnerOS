import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";

/** Ask the OS for an unused TCP port so runs never collide with orphans. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        srv.close(() => reject(new Error("could not allocate a port")));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Spin up a REAL PostgreSQL instance (downloaded binary, no Docker) so that RLS
 * — a genuine Postgres feature — is exercised exactly as in production. pg-mem
 * and similar fakes cannot enforce RLS, which would make our isolation tests
 * meaningless.
 *
 * Env vars are set here BEFORE any module that reads src/env is imported, then
 * db modules are pulled in via dynamic import. This is why callers receive the
 * loaded modules from this helper rather than importing them statically.
 */

export interface TestDb {
  readonly connectionString: string;
  readonly client: typeof import("@/db/client");
  readonly schema: typeof import("@/db/schema");
  readonly stop: () => Promise<void>;
}

function setBaselineEnv(connectionString: string): void {
  // NODE_ENV is typed readonly by @types/node; assign through the index signature.
  (process.env as Record<string, string>).NODE_ENV = "test";
  process.env.PARTNEROS_LOCAL_DEV = "true";
  process.env.PARTNEROS_DEPLOY_ENV = "";
  process.env.DATABASE_URL = connectionString;
  process.env.DATABASE_MIGRATOR_URL = connectionString;
  process.env.OIDC_ISSUER ??= "http://localhost:4444";
  process.env.OIDC_CLIENT_ID ??= "partneros-local";
  process.env.OIDC_CLIENT_SECRET ??= "local-stub-secret";
  process.env.OIDC_REDIRECT_URI ??= "http://localhost:3000/api/auth/callback";
  process.env.SESSION_JWT_SECRET ??=
    "test-only-secret-at-least-32-bytes-long-xx";
  process.env.S3_ENDPOINT ??= "http://localhost:9000";
  process.env.S3_REGION ??= "us-east-1";
  process.env.S3_BUCKET ??= "partneros-evidence";
  process.env.S3_ACCESS_KEY_ID ??= "local-stub";
  process.env.S3_SECRET_ACCESS_KEY ??= "local-stub-secret";
  process.env.MALWARE_SCAN_WEBHOOK_SECRET ??= "test-scan-hmac-secret";
}

export async function setupTestDb(): Promise<TestDb> {
  const port = await getFreePort();
  // A unique directory per (pid, port) outside the repo keeps the repo clean and
  // avoids any cross-run collision.
  const dir = join(tmpdir(), "partneros-pg", `t-${process.pid}-${port}`);
  await rm(dir, { recursive: true, force: true });

  const connectionString = `postgres://postgres:password@localhost:${port}/partneros`;
  setBaselineEnv(connectionString);

  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: "postgres",
    password: "password",
    authMethod: "password",
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });

  await pg.initialise();
  await pg.start();
  // From here on, any failure must still stop the cluster — otherwise the
  // postmaster orphans and holds its port (the bug that bit us on Windows).
  try {
    await pg.createDatabase("partneros");
    const { runMigrations } = await import("@/db/migrate");
    await runMigrations(connectionString);

    const client = await import("@/db/client");
    const schema = await import("@/db/schema");

    return {
      connectionString,
      client,
      schema,
      stop: async () => {
        await client.closeDb();
        await pg.stop();
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (err) {
    await pg.stop().catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}
