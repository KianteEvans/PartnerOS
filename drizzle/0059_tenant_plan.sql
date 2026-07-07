-- ============================================================================
-- Real per-workspace service-package entitlement.
--
-- Until now the service package (Essentials / Growth / Enterprise) was a
-- per-user cookie PREVIEW only -- nothing enforced it, the app stayed fully
-- unlocked. This adds tenants.plan so each workspace carries a real, persisted
-- entitlement the app fences against (packageFenceFor + PackageFence).
--
-- Default 'enterprise' so every EXISTING workspace stays fully unlocked (no
-- behavior change for the current tenant, seeds, or the agency's own
-- workspace). Agency-provisioned CUSTOMER workspaces are created at
-- 'essentials' explicitly (see createManagedWorkspaceOp); OBP moves a customer
-- up via setCustomerPlan.
--
-- No new GRANT: the table-level DML grant on tenants already covers new
-- columns, and plan is read/written through the privileged (withSystem) path
-- (loadWorkspacePlan / setCustomerPlanOp), never as partneros_app.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE package_tier AS ENUM ('essentials', 'growth', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan package_tier NOT NULL DEFAULT 'enterprise';
