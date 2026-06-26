import { beforeAll, afterEach, describe, it, expect } from "vitest";

// NODE_ENV is typed readonly by @types/node; mutate through a writable view.
const penv = process.env as Record<string, string | undefined>;

/**
 * Unit tests for the secure-by-default guard (Rule 3): PARTNEROS_LOCAL_DEV must
 * be impossible to honor in a deployed environment.
 */

let mod: typeof import("@/env");
const snapshot = { ...process.env };

beforeAll(async () => {
  // Minimal valid env so the module imports without throwing.
  penv.NODE_ENV = "test";
  process.env.PARTNEROS_LOCAL_DEV = "true";
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
  process.env.OIDC_ISSUER = "http://localhost:4444";
  process.env.OIDC_CLIENT_ID = "id";
  process.env.OIDC_CLIENT_SECRET = "secret";
  process.env.OIDC_REDIRECT_URI = "http://localhost:3000/cb";
  process.env.SESSION_JWT_SECRET = "x".repeat(40);
  process.env.S3_ENDPOINT = "http://localhost:9000";
  process.env.S3_BUCKET = "b";
  process.env.S3_ACCESS_KEY_ID = "k";
  process.env.S3_SECRET_ACCESS_KEY = "s";
  process.env.MALWARE_SCAN_WEBHOOK_SECRET = "scan";
  mod = await import("@/env");
});

afterEach(() => {
  // restore mutable deployment markers between cases
  for (const k of [
    "NODE_ENV",
    "PARTNEROS_DEPLOY_ENV",
    "VERCEL",
    "VERCEL_ENV",
    "AWS_LAMBDA_FUNCTION_NAME",
    "KUBERNETES_SERVICE_HOST",
    "PARTNEROS_LOCAL_DEV",
  ]) {
    if (k in snapshot) process.env[k] = snapshot[k];
    else delete process.env[k];
  }
});

describe("isDeployedEnvironment", () => {
  it("is false on a clean dev machine", () => {
    delete process.env.PARTNEROS_DEPLOY_ENV;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.KUBERNETES_SERVICE_HOST;
    penv.NODE_ENV = "development";
    expect(mod.__testing.isDeployedEnvironment()).toBe(false);
  });

  it("is true when NODE_ENV=production", () => {
    penv.NODE_ENV = "production";
    expect(mod.__testing.isDeployedEnvironment()).toBe(true);
  });

  it("is true when a platform marker is present", () => {
    penv.NODE_ENV = "development";
    process.env.VERCEL = "1";
    expect(mod.__testing.isDeployedEnvironment()).toBe(true);
  });

  it("is true when PARTNEROS_DEPLOY_ENV is set", () => {
    penv.NODE_ENV = "development";
    process.env.PARTNEROS_DEPLOY_ENV = "staging";
    expect(mod.__testing.isDeployedEnvironment()).toBe(true);
  });
});

describe("resolveLocalDev", () => {
  it("returns true when requested on a dev machine", () => {
    penv.NODE_ENV = "development";
    delete process.env.PARTNEROS_DEPLOY_ENV;
    delete process.env.VERCEL;
    process.env.PARTNEROS_LOCAL_DEV = "true";
    expect(mod.__testing.resolveLocalDev()).toBe(true);
  });

  it("returns false when not requested", () => {
    process.env.PARTNEROS_LOCAL_DEV = "false";
    expect(mod.__testing.resolveLocalDev()).toBe(false);
  });

  it("THROWS when requested in a deployed environment", () => {
    penv.NODE_ENV = "production";
    process.env.PARTNEROS_LOCAL_DEV = "true";
    expect(() => mod.__testing.resolveLocalDev()).toThrow(/deployed environment/);
  });
});
