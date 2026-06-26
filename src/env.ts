import { z } from "zod";

/**
 * Centralized, validated environment. Importing this module performs validation
 * exactly once at process start. A misconfigured environment is a hard boot
 * failure — never a silent fallback (Rule 3: secure by default).
 */

/**
 * Determine whether the process is running in a *deployed* environment.
 *
 * We treat any of the following as "deployed":
 *  - NODE_ENV === "production"
 *  - a platform-injected deployment marker (PARTNEROS_DEPLOY_ENV) is non-empty
 *  - common hosting markers exist (Vercel, AWS Lambda, Kubernetes service host)
 *
 * The point is that `PARTNEROS_LOCAL_DEV` can only ever take effect on a
 * developer's machine, and can NEVER be flipped on in a real deployment even if
 * an attacker or a misconfiguration sets the variable.
 */
function isDeployedEnvironment(): boolean {
  const env = process.env;
  if (env.NODE_ENV === "production") return true;
  if ((env.PARTNEROS_DEPLOY_ENV ?? "").trim() !== "") return true;
  // Platform-injected markers that are not settable from app config.
  if (env.VERCEL === "1" || (env.VERCEL_ENV ?? "") !== "") return true;
  if ((env.AWS_LAMBDA_FUNCTION_NAME ?? "") !== "") return true;
  if ((env.KUBERNETES_SERVICE_HOST ?? "") !== "") return true;
  return false;
}

/**
 * `next build` runs with NODE_ENV=production but is NOT a deployed runtime — it
 * is a compile step that imports modules (and thus this file) to collect page
 * data, often with placeholder env. We must not treat it as "deployed", and we
 * must not require runtime secrets during it. This is detected via Next's own
 * phase marker, which is set by the build command, not by deploy config.
 */
const IS_BUILD_PHASE = process.env.NEXT_PHASE === "phase-production-build";

/**
 * Resolve the local-dev opt-down flag. This is the ONLY switch that may relax a
 * default, and it is structurally impossible to enable in a deployed env.
 */
function resolveLocalDev(): boolean {
  // During the build phase, never enable local-dev semantics and never throw;
  // the flag only matters at runtime, evaluated again in the server process.
  if (IS_BUILD_PHASE) return false;
  const requested = (process.env.PARTNEROS_LOCAL_DEV ?? "").toLowerCase() === "true";
  if (!requested) return false;
  if (isDeployedEnvironment()) {
    throw new Error(
      "FATAL: PARTNEROS_LOCAL_DEV=true is set in a deployed environment. " +
        "This flag may only be used on a developer machine. Refusing to start.",
    );
  }
  return true;
}

export const IS_LOCAL_DEV = resolveLocalDev();

const base = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().url(),
  DATABASE_MIGRATOR_URL: z.string().url().optional(),

  OIDC_ISSUER: z.string().url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI: z.string().url(),

  // 32+ raw bytes once base64url-decoded.
  SESSION_JWT_SECRET: z
    .string()
    .min(32, "SESSION_JWT_SECRET must be at least 32 characters"),

  UPSTASH_REDIS_REST_URL: z.string().url().optional().or(z.literal("")),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional().or(z.literal("")),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  MALWARE_SCAN_WEBHOOK_SECRET: z.string().min(1),

  // Optional. Enables the in-app "Ask AWS" assistant (Assessments page), which
  // grounds answers in official AWS docs via the AWS Knowledge MCP server. When
  // unset/empty the feature is hidden — it never blocks boot.
  ANTHROPIC_API_KEY: z.string().min(1).optional().or(z.literal("")),
});

type Base = z.infer<typeof base>;

function parseEnv(): Base {
  const parsed = base.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`FATAL: invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

const parsed = parseEnv();

/**
 * Production hard requirements. In a deployed environment we refuse to run with
 * dev-only conveniences (in-memory rate limiter, missing Redis, etc.).
 */
function assertProductionInvariants(data: Base): void {
  if (IS_BUILD_PHASE) return; // build step: real secrets injected at runtime
  if (IS_LOCAL_DEV) return; // dev machine: relaxed adapters allowed
  const missing: string[] = [];
  if (!data.UPSTASH_REDIS_REST_URL) missing.push("UPSTASH_REDIS_REST_URL");
  if (!data.UPSTASH_REDIS_REST_TOKEN) missing.push("UPSTASH_REDIS_REST_TOKEN");
  if (missing.length > 0) {
    throw new Error(
      "FATAL: production requires real adapters. Missing/empty: " +
        missing.join(", ") +
        ". Set PARTNEROS_LOCAL_DEV=true only on a developer machine.",
    );
  }
}

assertProductionInvariants(parsed);

export const env = Object.freeze({
  ...parsed,
  IS_LOCAL_DEV,
  IS_DEPLOYED: isDeployedEnvironment(),
});

export type Env = typeof env;

// Exported for unit testing the guard logic in isolation.
export const __testing = { isDeployedEnvironment, resolveLocalDev };
