import { startOidcStub } from "./oidc-stub.js";

/**
 * Launch every local stub needed to run PartnerOS without external services:
 *   - OIDC stub server (HTTP)
 *   - Redis rate limiter -> in-memory adapter (no server; chosen automatically)
 *   - Object storage    -> local filesystem adapter (no server; chosen automatically)
 *
 * Real adapters are used the moment their env (UPSTASH_*, real S3, real OIDC)
 * is configured; these stubs are dev-only and gated by PARTNEROS_LOCAL_DEV.
 */
function main(): void {
  if (process.env.PARTNEROS_LOCAL_DEV !== "true") {
    console.error(
      "Refusing to start dev stubs: PARTNEROS_LOCAL_DEV must be 'true'.",
    );
    process.exit(1);
  }
  const oidc = startOidcStub();
  console.log("[stubs] Redis -> in-memory adapter (automatic)");
  console.log("[stubs] S3    -> local filesystem adapter (automatic)");

  const shutdown = (): void => {
    oidc.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
