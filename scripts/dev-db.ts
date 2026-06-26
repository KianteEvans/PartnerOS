import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import EmbeddedPostgres from "embedded-postgres";
import { runMigrations } from "../src/db/migrate.js";

/**
 * Dev-only: boot a REAL Postgres (downloaded binary, no Docker) on a fixed port,
 * apply migrations, and stay alive so `next dev` can connect over TCP. This is
 * the same engine the integration tests use. Kill the process to stop Postgres.
 */
const PORT = Number(process.env.DEV_DB_PORT ?? 54329);
const CONN = `postgres://postgres:password@localhost:${PORT}/partneros`;

async function main(): Promise<void> {
  const dir = join(tmpdir(), "partneros-dev-pg");
  await rm(dir, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port: PORT,
    user: "postgres",
    password: "password",
    authMethod: "password",
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("partneros");
  const applied = await runMigrations(CONN);
  console.log(`[dev-db] ready on ${CONN}`);
  console.log(`[dev-db] migrations: ${applied.length ? applied.join(", ") : "none pending"}`);

  const stop = async (): Promise<void> => {
    await pg.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // Keep the process (and Postgres) alive.
  setInterval(() => {}, 1 << 30);
}

main().catch((err: unknown) => {
  console.error("[dev-db] failed:", err);
  process.exit(1);
});
