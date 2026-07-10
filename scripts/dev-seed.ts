import postgres from "postgres";

/**
 * Dev-only: fill the auto-provisioned demo tenant with realistic cross-section
 * data so the dashboards (Command Center, Reporting, every section) light up.
 * Connects directly as the superuser (bypasses RLS) to the embedded dev Postgres.
 * Idempotent: clears the tenant's domain rows first, then reseeds.
 *
 *   npx tsx scripts/dev-seed.ts        # after logging in once so a tenant exists
 */
// Guard: this script CLEARS the tenant's domain tables before reseeding. It must
// never run against anything but a local dev database.
if ((process.env.PARTNEROS_LOCAL_DEV ?? "").toLowerCase() !== "true") {
  console.error(
    "[dev-seed] Refusing to run: PARTNEROS_LOCAL_DEV is not 'true'. " +
      "This script wipes and reseeds domain data and is for local dev only.",
  );
  process.exit(1);
}

const CONN = process.env.DATABASE_URL ?? "postgres://postgres:password@localhost:54329/partneros";

function isoOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Tenure cohort bucket for benchmarking — mirrors domain/benchmarks/percentiles. */
function tenureBucketOf(createdAt: Date, today: Date): string {
  let m =
    (today.getUTCFullYear() - createdAt.getUTCFullYear()) * 12 +
    (today.getUTCMonth() - createdAt.getUTCMonth());
  if (today.getUTCDate() < createdAt.getUTCDate()) m -= 1;
  if (m < 6) return "0_6mo";
  if (m < 12) return "6_12mo";
  if (m < 24) return "12_24mo";
  return "24mo_plus";
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
    const [tenant] = await sql<{ id: string; tier: string; created_at: Date }[]>`select id, tier, created_at from tenants order by created_at limit 1`;
    if (!tenant) {
      console.error("[seed] No tenant found. Log in once (http://localhost:3000) to provision one, then re-run.");
      process.exit(1);
    }
    const t = tenant.id;
    const [owner] = await sql<{ id: string }[]>`select id from users where tenant_id = ${t} and role = 'owner' limit 1`;
    const o = owner!.id;

    await sql.begin(async (tx) => {
      for (const table of [
        // AWS Marketplace mirror tables, children before the parent listing — without
        // these a re-seed leaves the old rows and trips the marketplace_listings unique
        // entity index, rolling back the whole transaction.
        "marketplace_private_offers",
        "marketplace_attributions", "marketplace_attribution_config", "marketplace_charges",
        "marketplace_agreements", "marketplace_entitlements", "marketplace_metering_records",
        "marketplace_customers", "marketplace_change_sets", "marketplace_pricing_dimensions",
        "marketplace_listings",
        "partner_central_opportunities", "aws_connection",
        "notifications", "playbook_runs", "playbooks", "notification_webhooks",
        "funding_submissions",
        "application_case_studies", "opportunity_case_studies", "application_controls", "competency_applications",
        "mdf_plan_items", "mdf_event_plans",
        "case_studies", "solutions",
        "roadmap_milestones", "roadmaps",
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
      const mdfRows = await tx<{ id: string; title: string }[]>`insert into mdf_requests ${tx(norm(mdfCols, [
        { tenant_id: t, title: "re:Invent booth", activity_type: "event", status: "approved", requested_amount: 50000, approved_amount: 40000, expected_pipeline: 220000, owner_user_id: o, claim_deadline: isoOffset(12), opportunity_ref: "PC-1001", created_by: o },
        { tenant_id: t, title: "Partner webinar series", activity_type: "campaign", status: "reimbursed", requested_amount: 15000, approved_amount: 15000, deployed_amount: 15000, claimed_amount: 14000, reimbursed_amount: 14000, expected_pipeline: 70000, owner_user_id: o, opportunity_ref: "OPP-9002", created_by: o },
        { tenant_id: t, title: "Field enablement kit", activity_type: "enablement", status: "draft", requested_amount: 8000, expected_pipeline: 30000, owner_user_id: o, created_by: o },
        // ROI-loop demo: approved spend that influenced a WON, launched deal (Acme renewal).
        { tenant_id: t, title: "Acme launch campaign", activity_type: "campaign", status: "reimbursed", requested_amount: 30000, approved_amount: 30000, deployed_amount: 30000, claimed_amount: 30000, reimbursed_amount: 30000, expected_pipeline: 100000, owner_user_id: o, opportunity_ref: "Acme renewal", created_by: o },
      ]), ...mdfCols)} returning id, title`;
      const webinarMdfId = mdfRows.find((r) => r.title === "Partner webinar series")?.id ?? null;

      const oppCols = ["tenant_id", "name", "account_name", "stage", "status", "amount", "source", "owner_user_id", "aws_seller", "next_step", "last_interaction", "close_date", "routing_status", "external_id", "created_by"] as const;
      const oppRows = await tx<{ id: string; name: string }[]>`insert into opportunities ${tx(norm(oppCols, [
        { tenant_id: t, name: "Globex cloud migration", account_name: "Globex", stage: "business_validation", status: "open", amount: 250000, source: "amazon_originated", owner_user_id: o, aws_seller: "Jane Patel (AWS)", next_step: "Schedule EBC", last_interaction: isoOffset(-45), close_date: isoOffset(40), routing_status: "routed", external_id: "PC-1001", created_by: o },
        { tenant_id: t, name: "Initech SaaS expansion", account_name: "Initech", stage: "qualified", status: "open", amount: 90000, source: "marketplace", owner_user_id: o, next_step: "Send private offer", last_interaction: isoOffset(-6), close_date: isoOffset(60), routing_status: "unrouted", external_id: "PC-1002", created_by: o },
        { tenant_id: t, name: "Acme renewal", account_name: "Acme", stage: "launched", status: "won", amount: 120000, source: "partner_originated", owner_user_id: o, next_step: "", routing_status: "approved", created_by: o },
      ]), ...oppCols)} returning id, name`;
      const globexOppId = oppRows.find((r) => r.name === "Globex cloud migration")?.id ?? null;
      // ROI loop (drizzle/0049): promote the free-text ref on the Acme campaign to the real FK,
      // so realized won revenue attributes to that MDF spend via the opportunity_id link.
      const acmeOppId = oppRows.find((r) => r.name === "Acme renewal")?.id ?? null;
      if (acmeOppId) {
        await tx`update mdf_requests set opportunity_id = ${acmeOppId}
                 where tenant_id = ${t} and opportunity_ref = ${"Acme renewal"}`;
      }

      // Win/loss mining (drizzle/0051): a book of CLOSED deals with honest close stamps +
      // loss reasons so the mining shows real cohorts. Vandelay (won, Globex account ->
      // attributes to Jane Patel via the account fallback) + Pied Piper (lost) are
      // MDF-backed below; with Acme renewal that gives the MDF factor 3 backed vs 3
      // un-backed closed deals (67% vs 33% win rate -> 2x lift, unsuppressed).
      const closedCols = ["tenant_id", "name", "account_name", "stage", "status", "amount", "source", "owner_user_id", "next_step", "loss_reason", "created_at", "closed_at", "close_date", "routing_status", "created_by"] as const;
      const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
      await tx`insert into opportunities ${tx(norm(closedCols, [
        { tenant_id: t, name: "Vandelay data lake", account_name: "Globex", stage: "launched", status: "won", amount: 180000, source: "amazon_originated", owner_user_id: o, next_step: "", loss_reason: "", created_at: daysAgo(95), closed_at: daysAgo(20), close_date: isoOffset(-20), routing_status: "approved", created_by: o },
        { tenant_id: t, name: "Hooli migration", account_name: "Hooli", stage: "committed", status: "won", amount: 60000, source: "partner_originated", owner_user_id: o, next_step: "", loss_reason: "", created_at: daysAgo(80), closed_at: daysAgo(35), close_date: isoOffset(-35), routing_status: "routed", created_by: o },
        { tenant_id: t, name: "Pied Piper platform", account_name: "Pied Piper", stage: "business_validation", status: "lost", amount: 150000, source: "amazon_originated", owner_user_id: o, next_step: "", loss_reason: "competitor", created_at: daysAgo(70), closed_at: daysAgo(15), close_date: isoOffset(-15), routing_status: "routed", created_by: o },
        { tenant_id: t, name: "Umbrella pilot", account_name: "Umbrella", stage: "qualified", status: "lost", amount: 30000, source: "partner_originated", owner_user_id: o, next_step: "", loss_reason: "price", created_at: daysAgo(75), closed_at: daysAgo(40), close_date: isoOffset(-40), routing_status: "routed", created_by: o },
        { tenant_id: t, name: "Stark expansion", account_name: "Stark", stage: "tech_validation", status: "lost", amount: 90000, source: "marketplace", owner_user_id: o, next_step: "", loss_reason: "timing", created_at: daysAgo(50), closed_at: daysAgo(8), close_date: isoOffset(-8), routing_status: "routed", created_by: o },
      ]), ...closedCols)}`;
      // Stamp the actual close on the pre-existing won Acme renewal too.
      await tx`update opportunities set closed_at = ${daysAgo(60)} where tenant_id = ${t} and name = ${"Acme renewal"}`;
      // MDF backing for one won + one lost closed deal (free-text ref -> byRef fallback).
      await tx`insert into mdf_requests ${tx(norm(mdfCols, [
        { tenant_id: t, title: "Vandelay launch campaign", activity_type: "campaign", status: "approved", requested_amount: 12000, approved_amount: 10000, expected_pipeline: 60000, owner_user_id: o, opportunity_ref: "Vandelay data lake", created_by: o },
        { tenant_id: t, title: "Pied Piper webinar", activity_type: "campaign", status: "approved", requested_amount: 8000, approved_amount: 6000, expected_pipeline: 40000, owner_user_id: o, opportunity_ref: "Pied Piper platform", created_by: o },
      ]), ...mdfCols)}`;

      // AWS Funding submissions (drizzle/0045): varied lifecycle states + one near-deadline and one
      // overdue so the tracker, portfolio metrics, matcher, and the Command `funding_deadline` signal
      // all have live data. The MAP request is linked to the Globex deal and carries a workload type so
      // the eligibility matcher lights up for that opportunity.
      const fundCols = ["tenant_id", "program_key", "title", "opportunity_id", "status", "funding_type", "workload_type", "customer_segment", "requested_amount", "approved_amount", "currency", "external_ref", "deadline", "decision_at", "decision_notes", "owner_user_id", "created_by"] as const;
      // The NOT NULL text columns (currency/external_ref/decision_notes/workload/segment) carry DB
      // defaults, but norm() nulls any omitted column -> spread these defaults so every row is valid.
      const fundBase = { currency: "USD", external_ref: "", decision_notes: "", workload_type: "", customer_segment: "" };
      await tx`insert into funding_submissions ${tx(norm(fundCols, [
        { ...fundBase, tenant_id: t, program_key: "map", title: "MAP migration funding - Globex", opportunity_id: globexOppId, status: "in_review", funding_type: "cash", workload_type: "migration", customer_segment: "enterprise", requested_amount: 50000, external_ref: "MAP-2026-0142", deadline: isoOffset(12), owner_user_id: o, created_by: o },
        { ...fundBase, tenant_id: t, program_key: "poc_funding", title: "POC credits - Initech analytics pilot", status: "approved", funding_type: "credits", workload_type: "analytics", customer_segment: "mid_market", requested_amount: 15000, approved_amount: 15000, decision_at: isoOffset(-3), decision_notes: "Approved for a 60-day proof of concept.", owner_user_id: o, created_by: o },
        { ...fundBase, tenant_id: t, program_key: "sif", title: "Strategic Investment Fund - net-new workload", status: "submitted", funding_type: "cash", workload_type: "net_new", customer_segment: "enterprise", requested_amount: 120000, external_ref: "SIF-2026-0088", deadline: isoOffset(-2), owner_user_id: o, created_by: o },
        { ...fundBase, tenant_id: t, program_key: "wafr", title: "Well-Architected review funding", status: "draft", funding_type: "cash", workload_type: "modernization", customer_segment: "smb", requested_amount: 5000, owner_user_id: o, created_by: o },
      ]), ...fundCols)}`;

      // AWS Partner Central mirror + connection (drizzle/0018): PC-1001 matches Globex exactly
      // (in sync); PC-1002 has drifted from Initech (AWS advanced the stage + bumped the amount);
      // PC-2001 exists only in AWS (not yet in ACE). Acme carries no external_id, so it's a manual
      // deal that never reconciles. Connection last synced ~4h ago => healthy (not stale).
      const pcCols = ["tenant_id", "external_id", "name", "account_name", "stage", "status", "amount", "aws_stage_raw"] as const;
      await tx`insert into partner_central_opportunities ${tx(norm(pcCols, [
        { tenant_id: t, external_id: "PC-1001", name: "Globex cloud migration", account_name: "Globex", stage: "business_validation", status: "open", amount: 250000, aws_stage_raw: "Business Validation" },
        { tenant_id: t, external_id: "PC-1002", name: "Initech SaaS expansion", account_name: "Initech", stage: "business_validation", status: "open", amount: 120000, aws_stage_raw: "Business Validation" },
        { tenant_id: t, external_id: "PC-2001", name: "Datadyne platform modernization", account_name: "Datadyne", stage: "prospect", status: "open", amount: 60000, aws_stage_raw: "Prospect" },
      ]), ...pcCols)}`;
      const syncedAt = new Date(Date.now() - 4 * 60 * 60 * 1000);
      await tx`insert into aws_connection (tenant_id, role_arn, external_id, region, catalog, enabled, status, last_synced_at, marketplace_enabled, marketplace_status, marketplace_last_synced_at)
        values (${t}, ${"arn:aws:iam::123456789012:role/PartnerOSConnect"}, ${"seed-external-id"}, ${"us-east-1"}, ${"Sandbox"}, ${true}, ${"configured"}, ${syncedAt}, ${true}, ${"configured"}, ${syncedAt})
        on conflict (tenant_id) do update set
          role_arn = excluded.role_arn, external_id = excluded.external_id, region = excluded.region,
          catalog = excluded.catalog, enabled = excluded.enabled, status = excluded.status,
          last_synced_at = excluded.last_synced_at, marketplace_enabled = excluded.marketplace_enabled,
          marketplace_status = excluded.marketplace_status, marketplace_last_synced_at = excluded.marketplace_last_synced_at,
          updated_at = now()`;

      const relCols = ["tenant_id", "name", "role", "account_name", "strength", "last_contact", "created_by"] as const;
      await tx`insert into ace_relationships ${tx(norm(relCols, [
        { tenant_id: t, name: "Jane Patel (AWS Seller)", role: "seller", account_name: "Globex", strength: 78, last_contact: isoOffset(-10), created_by: o },
        { tenant_id: t, name: "Raj Kumar (AWS SA)", role: "solutions_architect", account_name: "Initech", strength: 42, last_contact: isoOffset(-80), created_by: o },
      ]), ...relCols)}`;

      const evCols = ["tenant_id", "title", "evidence_type", "status", "quality_score", "owner_user_id", "expiration_date", "created_by"] as const;
      const evRows = await tx<{ id: string; title: string }[]>`insert into evidence ${tx(norm(evCols, [
        { tenant_id: t, title: "Globex migration case study", evidence_type: "case_study", status: "approved", quality_score: 88, owner_user_id: o, created_by: o },
        { tenant_id: t, title: "Security control documentation", evidence_type: "security", status: "in_review", owner_user_id: o, expiration_date: isoOffset(20), created_by: o },
        { tenant_id: t, title: "Reference architecture diagram", evidence_type: "architecture", status: "missing", created_by: o },
        { tenant_id: t, title: "Certified-staff roster", evidence_type: "certification", status: "collected", owner_user_id: o, expiration_date: isoOffset(50), created_by: o },
        // Proactive evidence_expired: approved evidence that has ALREADY lapsed -> coverage
        // silently lost (the expiring-soon signal deliberately skips already-expired rows).
        { tenant_id: t, title: "SOC 2 Type II report", evidence_type: "security", status: "approved", quality_score: 91, owner_user_id: o, expiration_date: isoOffset(-15), created_by: o },
      ]), ...evCols)} returning id, title`;
      const globexEvidenceId = evRows.find((r) => r.title === "Globex migration case study")?.id ?? null;

      // Case Studies (drizzle/0026): the narrative asset behind Competency customer
      // references. One public, complete story (sourced from the Globex evidence) plus
      // one anonymized private draft, so the list, detail aspects, and the application
      // "customer references" panel all render. ASCII only.
      const cstCols = ["tenant_id", "title", "customer_name", "anonymized", "visibility", "about_customer", "challenge", "goals", "solution", "outcomes", "url", "evidence_id", "created_by"] as const;
      const cstRows = await tx<{ id: string; title: string }[]>`insert into case_studies ${tx(norm(cstCols, [
        {
          tenant_id: t, title: "Globex cloud migration", customer_name: "Globex", anonymized: false, visibility: "public",
          about_customer: "Global media conglomerate, 12,000 employees, running a legacy on-prem estate of 400+ VMs.",
          challenge: "Quarterly releases, aging hardware nearing end-of-life, and rising licensing costs blocked product velocity.",
          goals: "Exit two data centers in 12 months, cut infrastructure cost 30 percent, and reach weekly release cadence.",
          solution: "Phased migration using AWS MGN for lift-and-shift, refactoring the ingest tier to serverless, guided by our Migration Competency practice.",
          outcomes: "Both data centers closed in 11 months, 38 percent infrastructure cost reduction, deployment frequency up 6x.",
          url: "https://acme.example/case-studies/globex", evidence_id: globexEvidenceId, created_by: o,
        },
        {
          tenant_id: t, title: "Regulated payments modernization", customer_name: "Confidential fintech", anonymized: true, visibility: "private",
          about_customer: "Mid-market payments processor in a regulated market.",
          challenge: "PCI-scoped monolith made audits slow and changes risky.",
          goals: "Isolate the cardholder data environment and automate evidence collection for audits.",
          solution: "Decomposed the monolith onto ECS with segmented VPCs and codified controls as config rules.",
          outcomes: "Audit preparation time cut from 6 weeks to 5 days; zero material findings in the last assessment.",
          url: "", evidence_id: null, created_by: o,
        },
      ]), ...cstCols)} returning id, title`;
      const globexCaseStudyId = cstRows.find((r) => r.title === "Globex cloud migration")?.id ?? null;
      // Pin the matching proof point to the Globex deal (Deal Desk "Relevant case
      // studies" demo: one pinned, the rest left for live match suggestions).
      if (globexOppId && globexCaseStudyId) {
        await tx`insert into opportunity_case_studies (tenant_id, opportunity_id, case_study_id, created_by)
          values (${t}, ${globexOppId}, ${globexCaseStudyId}, ${o})`;
      }

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

      // Attribute a couple of ACE opportunities to the Migration Competency so the
      // Partnership Map attribution flow (ACE → competency → attributed revenue) and the
      // Competency ROI surfaces have live data. Idempotent update.
      await tx`update programs set achieved_at = ${isoOffset(-120)} where id = ${prog!.id}`;
      await tx`update opportunities set program_id = ${prog!.id}
               where tenant_id = ${t} and name in ('Acme renewal', 'Globex cloud migration')`;

      // Solutions (drizzle/0028 + 0054 program back-link). Renewal bands are computed
      // live (renewal.ts), and this tenant's tier is "registered", so program types are
      // chosen to demo a real spread WITHOUT faking the tier: "Service Ready" (no tier
      // gate, FTR required for software) stays COMPLIANT; "Service Delivery" (no tier
      // gate, no FTR) with a ~45-day renewal lands AT RISK. Each is linked to a launched
      // opportunity so the 12-month launched-count criterion passes.
      const solCols = ["tenant_id", "title", "solution_type", "program_type", "description", "selling_proposition", "availability", "ftr_status", "url", "marketplace_url", "renewal_date", "program_id", "created_by"] as const;
      const solRows = await tx<{ id: string; title: string }[]>`insert into solutions ${tx(norm(solCols, [
        {
          tenant_id: t, title: "Acme Cloud Analytics", solution_type: "software_product", program_type: "Service Ready",
          description: "Real-time analytics on AWS with one-click Marketplace deployment.",
          selling_proposition: "Cuts time-to-insight from days to minutes on customer AWS accounts.",
          availability: "available", ftr_status: "approved", url: "https://acme.example/analytics",
          marketplace_url: "https://aws.amazon.com/marketplace/pp/acme-analytics", renewal_date: isoOffset(180),
          program_id: prog!.id, created_by: o,
        },
        {
          tenant_id: t, title: "Acme Migration Services", solution_type: "consulting_service", program_type: "Service Delivery",
          description: "Assessment-to-cutover migration delivery for enterprise estates.",
          selling_proposition: "MGN-based factory approach with fixed-fee waves.",
          availability: "available", ftr_status: "none", url: "https://acme.example/migrate",
          marketplace_url: "", renewal_date: isoOffset(45), program_id: null, created_by: o,
        },
      ]), ...solCols)} returning id, title`;
      const analyticsSolutionId = solRows.find((r) => r.title === "Acme Cloud Analytics")?.id ?? null;
      const migrationSolutionId = solRows.find((r) => r.title === "Acme Migration Services")?.id ?? null;
      // Launched-opportunity credit: the won+launched deals carry the solution FK.
      if (analyticsSolutionId) {
        await tx`update opportunities set solution_id = ${analyticsSolutionId}
                 where tenant_id = ${t} and name = ${"Acme renewal"}`;
      }
      if (migrationSolutionId) {
        await tx`update opportunities set solution_id = ${migrationSolutionId}
                 where tenant_id = ${t} and name = ${"Vandelay data lake"}`;
      }

      // Competency application (drizzle/0023/0025/0027/0033): one READY workbook with a
      // realistic packet (POC + AWS in_review), three controls across two sheets in the
      // three visible states, and the Globex case study attached as customer reference 1.
      const [app] = await tx<{ id: string }[]>`insert into competency_applications
          (tenant_id, name, competency, source_file_name, status, control_count, accepted_count,
           categories, poc_name, poc_email, poc_role, aws_status, submitted_at, solution_id, program_id, created_by)
        values (${t}, ${"Migration Competency Application"}, ${"Migration Competency"}, ${"MC-Self-Assessment-2026.xlsx"},
                ${"ready"}, ${3}, ${1}, ${"Migration; Modernization"}, ${"Jane Doe"}, ${"jane.doe@acme.example"},
                ${"Alliance Lead"}, ${"in_review"}, ${new Date(Date.now() - 6 * 86400000)},
                ${analyticsSolutionId}, ${prog!.id}, ${o})
        returning id`;
      const ctrlCols = ["tenant_id", "application_id", "sheet_name", "control_id", "requirement_text", "section", "response_target", "example_response", "recommended_response", "met_suggestion", "ai_confidence", "ai_reasoning", "linked_evidence_ids", "status", "sequence"] as const;
      await tx`insert into application_controls ${tx(norm(ctrlCols, [
        {
          tenant_id: t, application_id: app!.id, sheet_name: "Customer Examples", control_id: "1.1",
          requirement_text: "Describe a completed migration engagement including scope, timeline, and measurable outcomes.",
          section: "Case Study 1", response_target: tx.json([]),
          example_response: "Provide customer name, workload scope, and results.",
          recommended_response: "Migrated Globex's 400+ VM estate to AWS in 11 months using MGN; 38 percent cost reduction and 6x deployment frequency.",
          met_suggestion: "yes", ai_confidence: 86, ai_reasoning: "Grounded in the approved Globex migration case study evidence.",
          linked_evidence_ids: tx.json(globexEvidenceId ? [globexEvidenceId] : []), status: "accepted", sequence: 1,
        },
        {
          tenant_id: t, application_id: app!.id, sheet_name: "Customer Examples", control_id: "1.2",
          requirement_text: "Provide evidence of a documented migration methodology used across engagements.",
          section: "Practice", response_target: tx.json([]),
          example_response: "Reference your delivery kit or methodology document.",
          recommended_response: "Our wave-based migration factory: assess (2 weeks), mobilize, migrate in 25-VM waves, operate handoff.",
          met_suggestion: "partial", ai_confidence: 61, ai_reasoning: "Methodology summarized from program requirement notes; needs the delivery-kit artifact.",
          linked_evidence_ids: tx.json([]), status: "generated", sequence: 2,
        },
        {
          tenant_id: t, application_id: app!.id, sheet_name: "Technical Requirements", control_id: "2.1",
          requirement_text: "Demonstrate use of AWS migration tooling (MGN, DMS, or Migration Hub) in delivery.",
          section: "Tooling", response_target: tx.json([]),
          example_response: "List the services and how they are applied.",
          recommended_response: "",
          met_suggestion: "unknown", ai_confidence: 0, ai_reasoning: "",
          linked_evidence_ids: tx.json([]), status: "open", sequence: 1,
        },
      ]), ...ctrlCols)}`;
      if (globexCaseStudyId) {
        await tx`insert into application_case_studies (tenant_id, application_id, case_study_id, sequence)
          values (${t}, ${app!.id}, ${globexCaseStudyId}, ${1})`;
      }

      // MDF marketing plan (drizzle/0036/0037): one draft plan with a future event and a
      // near-term campaign; the campaign item is linked to the reimbursed webinar request
      // to demo the converted state on the plan detail.
      const [mdfPlan] = await tx<{ id: string }[]>`insert into mdf_event_plans (tenant_id, title, status, notes, created_by)
        values (${t}, ${"H2 2026 demand-gen plan"}, ${"draft"}, ${"Partner-led events and campaigns for the second half."}, ${o})
        returning id`;
      const planItemCols = ["tenant_id", "plan_id", "title", "description", "catalog_key", "activity_type", "total_cost", "co_fund_pct", "expected_pipeline", "expected_opportunities", "start_date", "end_date", "request_id"] as const;
      await tx`insert into mdf_plan_items ${tx(norm(planItemCols, [
        {
          tenant_id: t, plan_id: mdfPlan!.id, title: "re:Invent expansion booth",
          description: "Booth presence plus two speaking slots targeting migration buyers.",
          catalog_key: "industry-conference", activity_type: "event", total_cost: 60000, co_fund_pct: 50,
          expected_pipeline: 300000, expected_opportunities: 6, start_date: "2026-11-30", end_date: "2026-12-04", request_id: null,
        },
        {
          tenant_id: t, plan_id: mdfPlan!.id, title: "Modernization webinar series",
          description: "Three-part technical webinar series with AWS co-presenters.",
          catalog_key: "customer-webinar", activity_type: "campaign", total_cost: 15000, co_fund_pct: 50,
          expected_pipeline: 70000, expected_opportunities: 3, start_date: isoOffset(14), end_date: isoOffset(45), request_id: webinarMdfId,
        },
      ]), ...planItemCols)}`;

      const planCols = ["tenant_id", "current_tier", "target_tier", "status", "catalog_version", "owner_user_id", "created_by"] as const;
      const [plan] = await tx<{ id: string }[]>`insert into tier_plans ${tx(norm(planCols, [
        { tenant_id: t, current_tier: "registered", target_tier: "select", status: "active", catalog_version: 2, owner_user_id: o, created_by: o },
      ]), ...planCols)} returning id`;
      // The real AWS Select-tier criteria (catalog v2): an informational annual fee, accredited
      // individuals (Technical/Business), Foundational + Technical certs, and launched
      // opportunities with a secondary Total-MRR gate. Mixed current values for a live demo.
      const treqCols = ["tenant_id", "plan_id", "requirement_key", "label", "category", "unit", "threshold", "current_value", "kind", "secondary_label", "secondary_unit", "secondary_threshold", "secondary_current_value", "note", "informational"] as const;
      const treq = (row: Record<string, unknown>) => ({
        tenant_id: t, plan_id: plan!.id, kind: "count", secondary_current_value: 0, note: "", informational: false, ...row,
      });
      await tx`insert into tier_requirements ${tx(norm(treqCols, [
        treq({ requirement_key: "annual_apn_fee", label: "Annual APN fee", category: "fee", unit: "$/yr", threshold: 2500, current_value: 2500, informational: true }),
        treq({ requirement_key: "accredited_technical", label: "Accredited individuals - Technical", category: "accreditation", unit: "people", threshold: 2, current_value: 2 }),
        treq({ requirement_key: "accredited_business", label: "Accredited individuals - Business", category: "accreditation", unit: "people", threshold: 2, current_value: 1 }),
        treq({ requirement_key: "foundational_certs", label: "AWS Foundational certified individuals", category: "certifications", unit: "people", threshold: 2, current_value: 2 }),
        treq({ requirement_key: "technical_certs", label: "AWS Technical certified individuals", category: "certifications", unit: "people", threshold: 2, current_value: 1 }),
        treq({ requirement_key: "launched_opportunities", label: "Launched opportunities", category: "opportunities", unit: "opps", threshold: 3, current_value: 2, secondary_label: "Total MRR", secondary_unit: "$", secondary_threshold: 1500, secondary_current_value: 1200 }),
      ]), ...treqCols)}`;

      const aCols = ["tenant_id", "name", "preset", "status", "overall_score", "catalog_version", "created_by", "submitted_at"] as const;
      await tx`insert into assessments ${tx(norm(aCols, [
        { tenant_id: t, name: "Q3 Program Submission Readiness", preset: "program_submission", status: "scored", overall_score: 68, catalog_version: 1, owner_user_id: o, created_by: o, submitted_at: new Date() },
      ]), ...aCols)}`;

      const wsCols = ["tenant_id", "display_name", "automation_mode", "email_notifications", "benchmark_participation", "created_by"] as const;
      await tx`insert into workspace_settings ${tx(norm(wsCols, [
        { tenant_id: t, display_name: "Acme Cloud Partners", automation_mode: "auto_with_approval", email_notifications: true, benchmark_participation: true, created_by: o },
      ]), ...wsCols)}`;

      // Complete onboarding for the demo tenant (home renders the full hub only when
      // onboarding.status = 'completed'; a MISSING row means the first-run branch).
      // Upsert instead of insert: onboarding is one-row-per-tenant and deliberately NOT
      // in the wipe list (a user's real wizard progress should survive a reseed, but a
      // demo workspace should land on the hub). The completion handoffs (starter
      // roadmap, kickoff tasks, tier estimate) are NOT replicated — the seed creates
      // richer versions of all of them directly.
      await tx`insert into onboarding
          (tenant_id, status, step, company_name, industry, partner_type, aws_stage, team_size,
           objectives, path, completed_at, created_by)
        values (${t}, ${"completed"}, ${"done"}, ${"Acme Cloud Partners"}, ${"Software and consulting"},
                ${"consulting"}, ${"growing"}, ${"11-50"}, ${tx.json(["cosell", "mdf", "marketplace"])},
                ${"growth"}, ${new Date()}, ${o})
        on conflict (tenant_id) do update set
          status = ${"completed"}, step = ${"done"}, completed_at = now(), updated_at = now()`;

      // Cross-tenant benchmarking (Bet B, drizzle/0047). Seed today's metric_snapshot with
      // the three extra benchmarkable metrics, plus anonymized peer cohorts for this
      // tenant's tier + tenure so the Benchmarks panel + inline bands render live (a lone
      // dev tenant can never form a real k>=5 cohort). The cron aggregator produces these
      // in prod; here we fabricate plausible percentiles. Home overwrites today's snapshot
      // with live-computed values on first load — the cohorts (identity-free) persist.
      await tx`insert into metric_snapshots
          (tenant_id, captured_on, open_work, overdue, active_programs, programs_total,
           tier_percent, health_score, marketplace_published, marketplace_active_entitlements,
           marketplace_attributed_revenue_cents, win_rate_percent, evidence_percent, mdf_roi_x100)
        values (${t}, ${isoOffset(0)}, ${4}, ${1}, ${3}, ${5}, ${60}, ${74}, ${1}, ${2},
                ${4_200_000}, ${55}, ${67}, ${420})
        on conflict (tenant_id, captured_on) do update set
          health_score = excluded.health_score,
          win_rate_percent = excluded.win_rate_percent,
          evidence_percent = excluded.evidence_percent,
          mdf_roi_x100 = excluded.mdf_roi_x100`;

      const tenure = tenureBucketOf(new Date(tenant.created_at), new Date());
      const cohortPctl: Record<string, [number, number, number, number]> = {
        health: [55, 68, 80, 90],
        tier_percent: [30, 50, 70, 85],
        active_programs: [1, 2, 4, 6],
        marketplace_revenue: [500_000, 2_500_000, 8_000_000, 20_000_000],
        win_rate: [30, 45, 60, 75],
        evidence: [40, 60, 78, 90],
        mdf_roi: [150, 300, 500, 800],
      };
      await tx`delete from benchmark_cohorts`;
      for (const [metric, [p25, p50, p75, p90]] of Object.entries(cohortPctl)) {
        for (const [dim, val] of [["tier", tenant.tier] as const, ["tenure", tenure] as const]) {
          await tx`insert into benchmark_cohorts
              (cohort_dimension, cohort_value, metric, captured_on, p25, p50, p75, p90, sample_count)
            values (${dim}, ${val}, ${metric}, ${isoOffset(0)}, ${p25}, ${p50}, ${p75}, ${p90}, ${8})`;
        }
      }

      // Agency / portfolio mode (drizzle/0048): make the demo tenant an AGENCY managing a
      // few partner workspaces, plus one independent workspace to demo the "claim existing"
      // consent flow. Children carry a delegated agency service user (so act-as works
      // instantly), completed onboarding, and varied cross-section data so the portfolio grid
      // shows a spread of health / tier / pipeline / attention.
      await tx`update tenants set is_agency = true where id = ${t}`;
      const agencySub = `agency:${t}`;
      const agencyMail = `agency-${t}@managed.partneros.local`;
      const managedSpecs = [
        { name: "Northwind Cloud", slug: "northwind-cloud", tier: "advanced", opps: [180000, 95000], tasks: 1, overdue: 0 },
        { name: "Initech Systems", slug: "initech-systems", tier: "select", opps: [60000], tasks: 3, overdue: 1 },
        { name: "Hooli Partners", slug: "hooli-partners", tier: "registered", opps: [] as number[], tasks: 2, overdue: 2 },
      ];
      for (const m of managedSpecs) {
        await tx`delete from tenants where slug = ${m.slug}`;
        const [child] = await tx<{ id: string }[]>`insert into tenants (name, slug, tier, agency_id) values (${m.name}, ${m.slug}, ${m.tier}, ${t}) returning id`;
        const cid = child!.id;
        const [svc] = await tx<{ id: string }[]>`insert into users (tenant_id, oidc_subject, email, role, status) values (${cid}, ${agencySub}, ${agencyMail}, 'admin', 'active') returning id`;
        const su = svc!.id;
        await tx`insert into onboarding (tenant_id, status) values (${cid}, 'completed')`;
        if (m.opps.length > 0) {
          await tx`insert into opportunities ${tx(norm(oppCols, m.opps.map((amt, i) => ({
            tenant_id: cid, name: `${m.name} deal ${i + 1}`, account_name: m.name, stage: "qualified",
            status: "open", amount: amt, source: "partner_originated", owner_user_id: su,
            next_step: "Advance the deal", routing_status: "routed", created_by: su,
          }))), ...oppCols)}`;
        }
        await tx`insert into tasks ${tx(norm(taskCols, Array.from({ length: m.tasks }, (_, i) => {
          const overdue = i < m.overdue;
          return {
            tenant_id: cid, title: `Follow-up ${i + 1}`, status: "open",
            priority: overdue ? "high" : "medium", owner_user_id: su,
            due_date: isoOffset(overdue ? -3 : 7), source: "manual", created_by: su,
          };
        })), ...taskCols)}`;
      }
      // Independent workspace (not managed) so the "Claim existing" flow has a real target,
      // plus a pending outgoing request so the agency's Organization panel shows it.
      await tx`delete from tenants where slug = 'vandelay-industries'`;
      const [vandelay] = await tx<{ id: string }[]>`insert into tenants (name, slug, tier) values ('Vandelay Industries', 'vandelay-industries', 'select') returning id`;
      await tx`insert into agency_link_requests (agency_tenant_id, target_tenant_id, status, requested_by) values (${t}, ${vandelay!.id}, 'pending', ${o})`;

      // Automation playbooks (drizzle/0046): reactive rules (funding-deadline notify, overdue
      // create-task, MDF approve-within-cap) PLUS the proactive Wave-2 triggers (funding
      // re-match, stalled deal) so the engine demonstrably HUNTS, not just reacts. Runs
      // materialize live on the first Command Center load (nothing to seed there). One example
      // notification + a disabled webhook so the Channels + inbox surfaces render.
      const pbRows = [
        { name: "Notify owners of funding deadlines", desc: "In-app nudge when an AWS funding response is due soon.", situation: "funding_deadline", sev: "medium", action: "notify", params: {}, channels: ["in_app"] },
        { name: "Draft a follow-up for overdue critical work", desc: "Create a high-priority task when critical work slips.", situation: "overdue_work", sev: "critical", action: "create_task", params: { priority: "high" }, channels: ["in_app"] },
        { name: "Auto-approve MDF under $5k", desc: "Approve small MDF requests within a cap (waits for a human).", situation: "mdf_deadline", sev: "medium", action: "approve_within_cap", params: { cap: 5000 }, channels: ["in_app"] },
        { name: "Chase un-applied funding on live deals", desc: "Draft a task when an open deal is eligible for AWS funding it has not applied for.", situation: "funding_rematch", sev: "medium", action: "create_task", params: { priority: "high" }, channels: ["in_app"] },
        { name: "Nudge the owner when a deal stalls", desc: "Notify the owner when a high-value opportunity goes cold.", situation: "stalled_deal", sev: "high", action: "notify", params: {}, channels: ["in_app"] },
      ];
      for (const p of pbRows) {
        await tx`insert into playbooks (tenant_id, name, description, enabled, trigger_situation, trigger_min_severity, condition, action_type, action_params, channels, created_by)
          values (${t}, ${p.name}, ${p.desc}, true, ${p.situation}, ${p.sev}, ${tx.json({})}, ${p.action}, ${tx.json(p.params)}, ${tx.json(p.channels)}, ${o})`;
      }
      await tx`insert into notification_webhooks (tenant_id, url, secret, enabled) values (${t}, ${"https://example.com/hooks/partneros"}, ${""}, ${false})`;
      await tx`insert into notifications (tenant_id, user_id, source, severity, title, body, link, dedupe_key)
        values (${t}, ${o}, ${"playbook"}, ${"high"}, ${"Funding deadline approaching"}, ${"A seeded example in-app notification from the playbook engine."}, ${"/funding/submissions"}, ${"seed:example-1"})`;

      const connCols = ["tenant_id", "kind", "status", "auth_mode", "endpoint", "last_sync_at", "created_by"] as const;
      await tx`insert into connectors ${tx(norm(connCols, [
        { tenant_id: t, kind: "ace", status: "configured", auth_mode: "oauth", endpoint: "https://ace.aws.example", last_sync_at: new Date(), created_by: o },
        { tenant_id: t, kind: "salesforce", status: "configured", auth_mode: "oauth", endpoint: "https://acme.my.salesforce.com", last_sync_at: new Date(Date.now() - 12 * 86400000), created_by: o },
      ]), ...connCols)}`;

      // AWS Marketplace: a synced mirror state (AWS is the source of truth; in dev the mirror
      // is seeded to represent what the AWS APIs last returned so every tab renders).
      const day = (n: number) => new Date(Date.now() + n * 86400000);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const mlCols = ["tenant_id", "entity_id", "product_code", "title", "product_type", "visibility", "status", "description", "last_synced_at", "created_by"] as const;
      const mls = await tx<{ id: string; product_type: string }[]>`insert into marketplace_listings ${tx(norm(mlCols, [
        { tenant_id: t, entity_id: "entity:saas:acme", product_code: "acme-analytics-pc", title: "Acme Analytics", product_type: "saas", visibility: "public", status: "published", description: "Real-time analytics for AWS workloads.", last_synced_at: new Date(), created_by: o },
        { tenant_id: t, entity_id: "entity:ami:acme", product_code: "acme-gateway-pc", title: "Acme Secure Gateway", product_type: "ami", visibility: "limited", status: "draft", description: "Hardened gateway AMI for regulated workloads.", last_synced_at: new Date(), created_by: o },
      ]), ...mlCols)} returning id, product_type`;
      const saasId = mls.find((m) => m.product_type === "saas")!.id;
      const amiId = mls.find((m) => m.product_type === "ami")!.id;

      const dimCols = ["tenant_id", "listing_id", "api_name", "name", "unit", "price", "dimension_type"] as const;
      await tx`insert into marketplace_pricing_dimensions ${tx(norm(dimCols, [
        { tenant_id: t, listing_id: saasId, api_name: "users", name: "Per user / month", unit: "Users", price: 5000, dimension_type: "usage" },
        { tenant_id: t, listing_id: saasId, api_name: "hosts", name: "Per host / month", unit: "Hosts", price: 2000, dimension_type: "usage" },
        { tenant_id: t, listing_id: amiId, api_name: "hourly", name: "Per hour", unit: "Hours", price: 50, dimension_type: "usage" },
      ]), ...dimCols)}`;

      const csCols = ["tenant_id", "change_set_id", "listing_id", "intent", "status", "error", "started_at", "ended_at", "created_by"] as const;
      await tx`insert into marketplace_change_sets ${tx(norm(csCols, [
        { tenant_id: t, change_set_id: "cs-001", listing_id: saasId, intent: "publish", status: "succeeded", error: "", started_at: day(-3), ended_at: day(-3), created_by: o },
        { tenant_id: t, change_set_id: "cs-002", listing_id: amiId, intent: "add_dimension", status: "failed", error: "Dimension api name already in use", started_at: day(-1), ended_at: day(-1), created_by: o },
      ]), ...csCols)}`;

      const mcCols = ["tenant_id", "customer_identifier", "customer_aws_account_id", "product_code", "listing_id"] as const;
      await tx`insert into marketplace_customers ${tx(norm(mcCols, [
        { tenant_id: t, customer_identifier: "cust-globex", customer_aws_account_id: "111122223333", product_code: "acme-analytics-pc", listing_id: saasId },
      ]), ...mcCols)}`;

      const mrCols = ["tenant_id", "listing_id", "dimension", "customer_identifier", "quantity", "status", "metering_record_id", "result", "usage_timestamp", "created_by"] as const;
      await tx`insert into marketplace_metering_records ${tx(norm(mrCols, [
        { tenant_id: t, listing_id: saasId, dimension: "users", customer_identifier: "cust-globex", quantity: 25, status: "accepted", metering_record_id: "mr-1", result: "Success", usage_timestamp: day(-2), created_by: o },
        { tenant_id: t, listing_id: saasId, dimension: "hosts", customer_identifier: "cust-globex", quantity: 8, status: "accepted", metering_record_id: "mr-2", result: "Success", usage_timestamp: day(-1), created_by: o },
        { tenant_id: t, listing_id: saasId, dimension: "users", customer_identifier: "cust-initech", quantity: 5, status: "rejected", metering_record_id: "", result: "CustomerNotSubscribed", usage_timestamp: new Date(), created_by: o },
      ]), ...mrCols)}`;

      const meCols = ["tenant_id", "entitlement_id", "listing_id", "customer_identifier", "dimension", "value", "expiration_date", "agreement_id", "last_synced_at"] as const;
      await tx`insert into marketplace_entitlements ${tx(norm(meCols, [
        { tenant_id: t, entitlement_id: "acme-analytics-pc:cust-globex:users", listing_id: saasId, customer_identifier: "cust-globex", dimension: "users", value: 30, expiration_date: null, agreement_id: "agr-globex", last_synced_at: new Date() },
        { tenant_id: t, entitlement_id: "acme-analytics-pc:cust-initech:users", listing_id: saasId, customer_identifier: "cust-initech", dimension: "users", value: 10, expiration_date: iso(day(15)), agreement_id: "agr-initech", last_synced_at: new Date() },
      ]), ...meCols)}`;

      const maCols = ["tenant_id", "agreement_id", "listing_id", "customer_identifier", "offer_type", "status", "start_date", "end_date", "auto_renew", "total_value", "acceptance_time", "last_synced_at"] as const;
      await tx`insert into marketplace_agreements ${tx(norm(maCols, [
        { tenant_id: t, agreement_id: "agr-globex", listing_id: saasId, customer_identifier: "cust-globex", offer_type: "PublicOffer", status: "ACTIVE", start_date: iso(day(-120)), end_date: iso(day(245)), auto_renew: true, total_value: 3600000, acceptance_time: day(-120), last_synced_at: new Date() },
        { tenant_id: t, agreement_id: "agr-initech", listing_id: saasId, customer_identifier: "cust-initech", offer_type: "PrivateOffer", status: "ACTIVE", start_date: iso(day(-30)), end_date: iso(day(335)), auto_renew: false, total_value: 1200000, acceptance_time: day(-30), last_synced_at: new Date() },
      ]), ...maCols)}`;

      // Co-sell private offers (drizzle/0050): a DRAFT offer on the Globex deal (bridge to
      // ACE) + an ACCEPTED offer on the Initech deal reconciled to the real agr-initech
      // agreement — so the Offers tracker + the Deal Desk "Private offer" panel light up.
      const initechOppId = oppRows.find((r) => r.name === "Initech SaaS expansion")?.id ?? null;
      const poCols = ["tenant_id", "opportunity_id", "listing_id", "title", "customer_identifier", "customer_name", "offer_value", "discount_pct", "status", "created_by"] as const;
      await tx`insert into marketplace_private_offers ${tx(norm(poCols, [
        { tenant_id: t, opportunity_id: globexOppId, listing_id: saasId, title: "Globex cloud migration - private offer", customer_identifier: "cust-globex", customer_name: "Globex", offer_value: 120000, discount_pct: 10, status: "draft", created_by: o },
        { tenant_id: t, opportunity_id: initechOppId, listing_id: saasId, title: "Initech SaaS expansion - private offer", customer_identifier: "cust-initech", customer_name: "Initech", offer_value: 100000, discount_pct: 5, status: "accepted", created_by: o },
      ]), ...poCols)}`;
      await tx`update marketplace_private_offers po set agreement_id = a.id
               from marketplace_agreements a
               where po.tenant_id = ${t} and a.tenant_id = ${t}
                 and a.agreement_id = ${"agr-initech"} and po.customer_identifier = ${"cust-initech"}`;

      // Live roadmap reconciliation (drizzle/0050 Slice B): a FINALIZED roadmap whose
      // "Earn Migration Competency" milestone auto-completes on view (that competency is
      // active in this tenant), while "Earn Security Competency" stays planned (not active)
      // -- demonstrating forward-only auto-advance from real state.
      const [rmRow] = await tx<{ id: string }[]>`insert into roadmaps (tenant_id, name, objective, status, source, start_date, finalized_at, created_by)
        values (${t}, ${"Path to Advanced tier"}, ${"Earn the competencies to reach Advanced."}, ${"finalized"}, ${"manual"}, ${isoOffset(-30)}, ${new Date()}, ${o}) returning id`;
      const rmMsCols = ["tenant_id", "roadmap_id", "sequence", "title", "detail", "target_date", "owner_user_id", "origin_kind", "origin_label", "origin_ref", "status"] as const;
      await tx`insert into roadmap_milestones ${tx(norm(rmMsCols, [
        { tenant_id: t, roadmap_id: rmRow!.id, sequence: 1, title: "Earn Migration Competency", detail: "AWS Migration Competency.", target_date: isoOffset(30), owner_user_id: o, origin_kind: "program", origin_label: "Migration Competency", origin_ref: "migration_competency", status: "planned" },
        { tenant_id: t, roadmap_id: rmRow!.id, sequence: 2, title: "Earn Security Competency", detail: "AWS Security Competency.", target_date: isoOffset(90), owner_user_id: o, origin_kind: "program", origin_label: "Security Competency", origin_ref: "security_competency", status: "planned" },
      ]), ...rmMsCols)}`;

      // Forecasting suite (Wave 3): backfill ~45 days of daily snapshot history so the
      // Monte-Carlo projections on /reports/forecasts render from a realistic series.
      // Deterministic (no Math.random): steady growth plus a small periodic wobble.
      const FC_DAYS = 45;
      const revSnapCols = ["tenant_id", "captured_on", "listings", "published", "active_entitlements", "metered_usage_cents", "attributed_revenue_cents", "mrr_cents"] as const;
      const metricSnapCols = ["tenant_id", "captured_on", "open_work", "overdue", "active_programs", "programs_total", "tier_percent", "health_score", "marketplace_published", "marketplace_active_entitlements", "marketplace_attributed_revenue_cents", "win_rate_percent", "evidence_percent", "mdf_roi_x100"] as const;
      const rmSnapCols = ["tenant_id", "roadmap_id", "captured_on", "done", "total", "overdue", "in_progress"] as const;
      const revBack: Record<string, unknown>[] = [];
      const metricBack: Record<string, unknown>[] = [];
      const rmSnapBack: Record<string, unknown>[] = [];
      for (let i = FC_DAYS; i >= 1; i--) {
        const day = isoOffset(-i);
        const k = FC_DAYS - i; // 0..44, rising toward today
        revBack.push({ tenant_id: t, captured_on: day, listings: 2, published: 1, active_entitlements: 2, metered_usage_cents: 2_000_000 + k * 45_000 + (k % 7) * 20_000, attributed_revenue_cents: 3_000_000 + k * 60_000 + (k % 5) * 25_000, mrr_cents: 900_000 + k * 12_000 + (k % 7) * 5_000 });
        metricBack.push({ tenant_id: t, captured_on: day, open_work: 5, overdue: 1, active_programs: 2, programs_total: 5, tier_percent: 40 + Math.floor(k / 3), health_score: 58 + Math.floor(k / 4) + (k % 3), marketplace_published: 1, marketplace_active_entitlements: 2, marketplace_attributed_revenue_cents: 3_000_000 + k * 60_000, win_rate_percent: 44 + (k % 9), evidence_percent: 55 + Math.floor(k / 5), mdf_roi_x100: 380 + (k % 6) * 10 });
        // Burn-up: milestone 1 completed ~3 weeks ago; the second still open -> the MC
        // forecast projects the remaining milestone (kept below live done=2 so the
        // completion forecast stays honest against the live milestone state).
        rmSnapBack.push({ tenant_id: t, roadmap_id: rmRow!.id, captured_on: day, done: Math.min(1, Math.floor(k / 25)), total: 2, overdue: 0, in_progress: 1 });
      }
      await tx`insert into marketplace_revenue_snapshots ${tx(norm(revSnapCols, revBack), ...revSnapCols)} on conflict (tenant_id, captured_on) do nothing`;
      await tx`insert into metric_snapshots ${tx(norm(metricSnapCols, metricBack), ...metricSnapCols)} on conflict (tenant_id, captured_on) do nothing`;
      await tx`insert into roadmap_snapshots ${tx(norm(rmSnapCols, rmSnapBack), ...rmSnapCols)} on conflict (tenant_id, roadmap_id, captured_on) do nothing`;

      // An active MDF budget spanning today so the optimizer has remaining dollars to split.
      await tx`insert into mdf_budgets (tenant_id, period_label, period_start, period_end, amount, created_by)
        values (${t}, ${"FY26 H2 MDF"}, ${isoOffset(-30)}, ${isoOffset(60)}, ${120_000}, ${o})`;

      const mchCols = ["tenant_id", "charge_ref", "agreement_id", "listing_id", "billing_period_start", "billing_period_end", "dimension", "quantity", "amount", "invoice_line_item"] as const;
      await tx`insert into marketplace_charges ${tx(norm(mchCols, [
        { tenant_id: t, charge_ref: "chg-1", agreement_id: "agr-globex", listing_id: saasId, billing_period_start: "2026-04-01", billing_period_end: "2026-04-30", dimension: "users", quantity: 30, amount: 150000, invoice_line_item: "April users" },
        { tenant_id: t, charge_ref: "chg-2", agreement_id: "agr-globex", listing_id: saasId, billing_period_start: "2026-05-01", billing_period_end: "2026-05-31", dimension: "users", quantity: 30, amount: 150000, invoice_line_item: "May users" },
        { tenant_id: t, charge_ref: "chg-3", agreement_id: "agr-globex", listing_id: saasId, billing_period_start: "2026-06-01", billing_period_end: "2026-06-30", dimension: "users", quantity: 30, amount: 150000, invoice_line_item: "June users" },
        { tenant_id: t, charge_ref: "chg-4", agreement_id: "agr-initech", listing_id: saasId, billing_period_start: "2026-06-01", billing_period_end: "2026-06-30", dimension: "users", quantity: 10, amount: 50000, invoice_line_item: "June users" },
      ]), ...mchCols)}`;

      const cfgCols = ["tenant_id", "listing_id", "method", "enabled", "status", "notes", "created_by"] as const;
      await tx`insert into marketplace_attribution_config ${tx(norm(cfgCols, [
        { tenant_id: t, listing_id: saasId, method: "marketplace_metering", enabled: true, status: "active", notes: "Zero-touch attribution via Marketplace metering.", created_by: o },
        { tenant_id: t, listing_id: saasId, method: "resource_tagging", enabled: true, status: "active", notes: "Tagged EC2 + S3 with the product code.", created_by: o },
        { tenant_id: t, listing_id: saasId, method: "user_agent", enabled: false, status: "inactive", notes: "", created_by: o },
      ]), ...cfgCols)}`;

      const matCols = ["tenant_id", "attribution_ref", "listing_id", "aws_service", "billing_period", "amount", "method", "last_synced_at"] as const;
      await tx`insert into marketplace_attributions ${tx(norm(matCols, [
        { tenant_id: t, attribution_ref: "entity:saas:acme:AmazonEC2:2026-05:marketplace_metering", listing_id: saasId, aws_service: "Amazon EC2", billing_period: "2026-05", amount: 420000, method: "marketplace_metering", last_synced_at: new Date() },
        { tenant_id: t, attribution_ref: "entity:saas:acme:AmazonS3:2026-05:resource_tagging", listing_id: saasId, aws_service: "Amazon S3", billing_period: "2026-05", amount: 90000, method: "resource_tagging", last_synced_at: new Date() },
        { tenant_id: t, attribution_ref: "entity:saas:acme:AmazonEC2:2026-06:marketplace_metering", listing_id: saasId, aws_service: "Amazon EC2", billing_period: "2026-06", amount: 510000, method: "marketplace_metering", last_synced_at: new Date() },
        { tenant_id: t, attribution_ref: "entity:saas:acme:AmazonRDS:2026-06:resource_tagging", listing_id: saasId, aws_service: "Amazon RDS", billing_period: "2026-06", amount: 130000, method: "resource_tagging", last_synced_at: new Date() },
      ]), ...matCols)}`;

      // Saved executive narrative (drizzle/0052): one DRAFT report with a frozen
      // snapshot + an outline-style narrative so /reports/[id] and the print packet
      // render the story with no AI key. ASCII-only (the dev DB is WIN1252) and the
      // posture numbers are hand-checked against healthFromSnapshot: drivers
      // Evidence 67 / Programs 50 / Tier 62 / Tasks 67 / ACE 50 / MDF 83 /
      // Marketplace 50 -> 61/100 (fair); strongest MDF, weakest (tie-broken) Programs.
      const reportSnapshot = {
        mdf: { requested: 103000, approved: 85000, deployed: 45000, claimed: 44000, reimbursed: 44000, remaining: 41000, pipeline: 420000, roi: 4.9, deadlineRisks: 1, open: 1 },
        ace: { open: 2, openValue: 340000, won: 3, wonValue: 360000, atRisk: 1, unrouted: 1 },
        evidence: { total: 6, approved: 4, missing: 2, percent: 67 },
        programs: { total: 4, active: 2, pending: 1, expired: 1 },
        tier: { current: "Advanced", target: "Premier", status: "active", met: 5, total: 8, percent: 62 },
        tasks: { total: 5, open: 3, done: 1, overdue: 1 },
        assessments: { count: 1, scored: 1, latestScore: 72 },
        marketplace: { listings: 2, published: 1, activeEntitlements: 3, attributedRevenueCents: 8200000 },
      };
      const reportNarrative = [
        `As of ${isoOffset(0)}, partnership health stands at 61/100 (fair). MDF is the strongest driver at 83, while Programs lags at 50.`,
        "Where value is flowing: MDF -> ACE co-sell (2 backed deals); ACE co-sell -> Tier: Premier (3 launched).",
        "Watch items: 1 MDF deadline risk, 1 at-risk co-sell deal, 1 overdue task, 2 evidence gaps.",
        "Tier trajectory: Advanced -> Premier, 62% of requirements met (5/8). In motion: 2 open opportunities worth $340,000, 1 open MDF request, 1 unrouted deal.",
      ].join("\n\n");
      await tx`insert into reports (tenant_id, title, report_type, status, period_start, period_end, snapshot, summary, narrative, created_by)
        values (${t}, ${"Q2 executive review"}, ${"executive_plan"}, ${"draft"}, ${isoOffset(-90)}, ${isoOffset(0)}, ${tx.json(reportSnapshot)},
          ${"Executive plan. MDF: $85,000 approved of $103,000 requested (ROI 4.9x). ACE: 2 open opportunities worth $340,000, 1 at risk. Evidence 67% approved. 2 active programs, 1 in progress. Tier Advanced->Premier at 62%. 3 open tasks (1 overdue)."},
          ${reportNarrative}, ${o})`;
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
