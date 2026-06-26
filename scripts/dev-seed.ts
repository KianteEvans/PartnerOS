import postgres from "postgres";

/**
 * Dev-only: fill the auto-provisioned demo tenant with realistic cross-section
 * data so the dashboards (Command Center, Reporting, every section) light up.
 * Connects directly as the superuser (bypasses RLS) to the embedded dev Postgres.
 * Idempotent: clears the tenant's domain rows first, then reseeds.
 *
 *   npx tsx scripts/dev-seed.ts        # after logging in once so a tenant exists
 */
const CONN = process.env.DATABASE_URL ?? "postgres://postgres:password@localhost:54329/partneros";

function isoOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Normalize heterogeneous rows so every row has every column (undefined -> null). */
function norm(
  cols: readonly string[],
  items: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  return items.map((it) =>
    Object.fromEntries(cols.map((c) => [c, it[c] === undefined ? null : it[c]])),
  );
}

async function main(): Promise<void> {
  const sql = postgres(CONN, { max: 1, onnotice: () => {} });
  try {
    const [tenant] = await sql<{ id: string }[]>`select id from tenants order by created_at limit 1`;
    if (!tenant) {
      console.error("[seed] No tenant found. Log in once (http://localhost:3000) to provision one, then re-run.");
      process.exit(1);
    }
    const t = tenant.id;
    const [owner] = await sql<{ id: string }[]>`select id from users where tenant_id = ${t} and role = 'owner' limit 1`;
    const o = owner!.id;

    await sql.begin(async (tx) => {
      for (const table of [
        "reports", "connectors", "workspace_settings", "ace_relationships", "opportunities",
        "tier_requirements", "tier_plans", "program_requirements", "programs",
        "evidence", "mdf_requests", "assessment_recommendations", "assessment_modules",
        "assessment_responses", "assessments", "tasks",
      ]) {
        await tx.unsafe(`delete from ${table} where tenant_id = $1`, [t]);
      }

      const taskCols = ["tenant_id", "title", "status", "priority", "owner_user_id", "due_date", "source", "created_by"] as const;
      await tx`insert into tasks ${tx(norm(taskCols, [
        { tenant_id: t, title: "Finalize Migration Competency submission", status: "open", priority: "critical", owner_user_id: o, due_date: isoOffset(-3), source: "program", created_by: o },
        { tenant_id: t, title: "Collect Globex case study", status: "open", priority: "high", owner_user_id: o, due_date: isoOffset(5), source: "evidence", created_by: o },
        { tenant_id: t, title: "Resolve certification renewal blocker", status: "blocked", priority: "medium", owner_user_id: o, due_date: isoOffset(2), source: "tier", created_by: o },
        { tenant_id: t, title: "Prepare Q3 QBR deck", status: "in_progress", priority: "high", owner_user_id: o, due_date: isoOffset(8), source: "manual", created_by: o },
        { tenant_id: t, title: "Update partner profile", status: "done", priority: "low", owner_user_id: o, due_date: isoOffset(-10), source: "onboarding", created_by: o },
      ]), ...taskCols)}`;

      const mdfCols = ["tenant_id", "title", "activity_type", "status", "requested_amount", "approved_amount", "deployed_amount", "claimed_amount", "reimbursed_amount", "expected_pipeline", "owner_user_id", "claim_deadline", "opportunity_ref", "created_by"] as const;
      await tx`insert into mdf_requests ${tx(norm(mdfCols, [
        { tenant_id: t, title: "re:Invent booth", activity_type: "event", status: "approved", requested_amount: 50000, approved_amount: 40000, expected_pipeline: 220000, owner_user_id: o, claim_deadline: isoOffset(12), opportunity_ref: "OPP-9001", created_by: o },
        { tenant_id: t, title: "Partner webinar series", activity_type: "campaign", status: "reimbursed", requested_amount: 15000, approved_amount: 15000, deployed_amount: 15000, claimed_amount: 14000, reimbursed_amount: 14000, expected_pipeline: 70000, owner_user_id: o, opportunity_ref: "OPP-9002", created_by: o },
        { tenant_id: t, title: "Field enablement kit", activity_type: "enablement", status: "draft", requested_amount: 8000, expected_pipeline: 30000, owner_user_id: o, created_by: o },
      ]), ...mdfCols)}`;

      const oppCols = ["tenant_id", "name", "account_name", "stage", "status", "amount", "source", "owner_user_id", "aws_seller", "next_step", "last_interaction", "close_date", "routing_status", "created_by"] as const;
      await tx`insert into opportunities ${tx(norm(oppCols, [
        { tenant_id: t, name: "Globex cloud migration", account_name: "Globex", stage: "business_validation", status: "open", amount: 250000, source: "amazon_originated", owner_user_id: o, aws_seller: "Jane Patel (AWS)", next_step: "Schedule EBC", last_interaction: isoOffset(-45), close_date: isoOffset(40), routing_status: "routed", created_by: o },
        { tenant_id: t, name: "Initech SaaS expansion", account_name: "Initech", stage: "qualified", status: "open", amount: 90000, source: "marketplace", owner_user_id: o, next_step: "Send private offer", last_interaction: isoOffset(-6), close_date: isoOffset(60), routing_status: "unrouted", created_by: o },
        { tenant_id: t, name: "Acme renewal", account_name: "Acme", stage: "launched", status: "won", amount: 120000, source: "partner_originated", owner_user_id: o, next_step: "", routing_status: "approved", created_by: o },
      ]), ...oppCols)}`;

      const relCols = ["tenant_id", "name", "role", "account_name", "strength", "last_contact", "created_by"] as const;
      await tx`insert into ace_relationships ${tx(norm(relCols, [
        { tenant_id: t, name: "Jane Patel (AWS Seller)", role: "seller", account_name: "Globex", strength: 78, last_contact: isoOffset(-10), created_by: o },
        { tenant_id: t, name: "Raj Kumar (AWS SA)", role: "solutions_architect", account_name: "Initech", strength: 42, last_contact: isoOffset(-80), created_by: o },
      ]), ...relCols)}`;

      const evCols = ["tenant_id", "title", "evidence_type", "status", "quality_score", "owner_user_id", "expiration_date", "created_by"] as const;
      await tx`insert into evidence ${tx(norm(evCols, [
        { tenant_id: t, title: "Globex migration case study", evidence_type: "case_study", status: "approved", quality_score: 88, owner_user_id: o, created_by: o },
        { tenant_id: t, title: "Security control documentation", evidence_type: "security", status: "in_review", owner_user_id: o, expiration_date: isoOffset(20), created_by: o },
        { tenant_id: t, title: "Reference architecture diagram", evidence_type: "architecture", status: "missing", created_by: o },
        { tenant_id: t, title: "Certified-staff roster", evidence_type: "certification", status: "collected", owner_user_id: o, expiration_date: isoOffset(50), created_by: o },
      ]), ...evCols)}`;

      const progCols = ["tenant_id", "library_key", "name", "program_type", "delivery_model", "funding_fit", "status", "owner_user_id", "expiration_date", "created_by"] as const;
      const [prog] = await tx<{ id: string }[]>`insert into programs ${tx(norm(progCols, [
        { tenant_id: t, library_key: "migration_competency", name: "Migration Competency", program_type: "Competency", delivery_model: "Consulting", funding_fit: "high", status: "active", owner_user_id: o, expiration_date: isoOffset(75), created_by: o },
      ]), ...progCols)} returning id`;
      const reqCols = ["tenant_id", "program_id", "requirement_key", "label", "expected_evidence_type", "status"] as const;
      await tx`insert into program_requirements ${tx(norm(reqCols, [
        { tenant_id: t, program_id: prog!.id, requirement_key: "customer_references", label: "Public customer references", expected_evidence_type: "case_study", status: "met" },
        { tenant_id: t, program_id: prog!.id, requirement_key: "technical_validation", label: "Technical / architecture validation", expected_evidence_type: "architecture", status: "open" },
        { tenant_id: t, program_id: prog!.id, requirement_key: "certified_staff", label: "Certified staff headcount", expected_evidence_type: "certification", status: "met" },
        { tenant_id: t, program_id: prog!.id, requirement_key: "self_assessment", label: "Completed self-assessment workbook", expected_evidence_type: "reference", status: "open" },
      ]), ...reqCols)}`;

      const planCols = ["tenant_id", "current_tier", "target_tier", "status", "catalog_version", "owner_user_id", "created_by"] as const;
      const [plan] = await tx<{ id: string }[]>`insert into tier_plans ${tx(norm(planCols, [
        { tenant_id: t, current_tier: "registered", target_tier: "select", status: "active", catalog_version: 1, owner_user_id: o, created_by: o },
      ]), ...planCols)} returning id`;
      const treqCols = ["tenant_id", "plan_id", "requirement_key", "label", "category", "unit", "threshold", "current_value"] as const;
      await tx`insert into tier_requirements ${tx(norm(treqCols, [
        { tenant_id: t, plan_id: plan!.id, requirement_key: "launched_opportunities", label: "Launched opportunities", category: "opportunities", unit: "opps", threshold: 1, current_value: 1 },
        { tenant_id: t, plan_id: plan!.id, requirement_key: "aws_certifications", label: "AWS certifications", category: "certifications", unit: "certs", threshold: 2, current_value: 1 },
        { tenant_id: t, plan_id: plan!.id, requirement_key: "customer_references", label: "Customer references", category: "references", unit: "refs", threshold: 1, current_value: 1 },
      ]), ...treqCols)}`;

      const aCols = ["tenant_id", "name", "preset", "status", "overall_score", "catalog_version", "created_by", "submitted_at"] as const;
      await tx`insert into assessments ${tx(norm(aCols, [
        { tenant_id: t, name: "Q3 Program Submission Readiness", preset: "program_submission", status: "scored", overall_score: 68, catalog_version: 1, owner_user_id: o, created_by: o, submitted_at: new Date() },
      ]), ...aCols)}`;

      const wsCols = ["tenant_id", "display_name", "automation_mode", "email_notifications", "created_by"] as const;
      await tx`insert into workspace_settings ${tx(norm(wsCols, [
        { tenant_id: t, display_name: "Acme Cloud Partners", automation_mode: "auto_with_approval", email_notifications: true, created_by: o },
      ]), ...wsCols)}`;
      const connCols = ["tenant_id", "kind", "status", "auth_mode", "endpoint", "last_sync_at", "created_by"] as const;
      await tx`insert into connectors ${tx(norm(connCols, [
        { tenant_id: t, kind: "ace", status: "configured", auth_mode: "oauth", endpoint: "https://ace.aws.example", last_sync_at: new Date(), created_by: o },
        { tenant_id: t, kind: "salesforce", status: "configured", auth_mode: "oauth", endpoint: "https://acme.my.salesforce.com", last_sync_at: new Date(Date.now() - 12 * 86400000), created_by: o },
      ]), ...connCols)}`;
    });

    console.log(`[seed] Seeded demo data for tenant ${t}.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
