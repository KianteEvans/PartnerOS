import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * Migration runner. Applies the raw SQL files in drizzle/ in lexical order,
 * each in its own transaction, tracked in a _migrations ledger. Raw SQL (not the
 * Drizzle DSL) is the source of truth because RLS policies and role grants are
 * not expressible in the schema builder (Rule 2).
 *
 * Runs as the migrator/owner connection (DATABASE_MIGRATOR_URL), which DOES own
 * the tables — that is the only context allowed to bypass RLS for DDL.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "..", "drizzle");

export async function runMigrations(connectionString: string): Promise<string[]> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  const applied: string[] = [];
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `;

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const already = await sql`SELECT 1 FROM _migrations WHERE name = ${file}`;
      if (already.length > 0) continue;

      const contents = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// CLI entrypoint: `npm run db:migrate`.
const isCliEntry =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isCliEntry) {
  const conn =
    process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL ?? "";
  if (!conn) {
    console.error("FATAL: DATABASE_MIGRATOR_URL or DATABASE_URL must be set.");
    process.exit(1);
  }
  runMigrations(conn)
    .then((applied) => {
      if (applied.length === 0) console.log("No pending migrations.");
      else console.log(`Applied: ${applied.join(", ")}`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
