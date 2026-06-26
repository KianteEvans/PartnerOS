import { defineConfig } from "drizzle-kit";

// drizzle-kit reads DATABASE_URL directly; migrations themselves live as raw SQL
// in drizzle/ so that RLS policies (unsupported by the schema DSL) are first-class.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/partneros",
  },
  strict: true,
  verbose: true,
});
