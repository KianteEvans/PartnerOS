import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  jsonb,
  integer,
  bigint,
  boolean,
  index,
  uniqueIndex,
  pgEnum,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema. Every domain object is a real typed table with explicit
 * columns, FKs, and constraints (Rule 1). RLS policies are NOT expressible here;
 * they live in raw SQL migrations under drizzle/ (Rule 2). This schema is the
 * source of truth for column types and is kept in lockstep with those SQL files.
 */

export const partnerTier = pgEnum("partner_tier", [
  "registered",
  "select",
  "advanced",
  "premier",
]);

// Service-package entitlement (PartnerOS packaging: Establish/Scale/Operate).
// NOT the AWS partner tier above. Persisted per workspace in tenants.plan and
// enforced via src/domain/packaging (packageFenceFor + PackageFence).
export const packageTier = pgEnum("package_tier", [
  "essentials",
  "growth",
  "enterprise",
]);

export const userRole = pgEnum("user_role", [
  "owner",
  "admin",
  "manager",
  "member",
  "viewer",
]);

export const userStatus = pgEnum("user_status", ["active", "disabled"]);

export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
]);

export const scanStatus = pgEnum("scan_status", [
  "pending",
  "clean",
  "infected",
  "error",
]);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    tier: partnerTier("tier").notNull().default("registered"),
    // Service-package entitlement (drizzle/0059). Default 'enterprise' keeps
    // every existing workspace fully unlocked; agency-provisioned customer
    // workspaces are created at 'essentials'. Read/written via withSystem.
    plan: packageTier("plan").notNull().default("enterprise"),
    // Agency / portfolio mode (drizzle/0048). is_agency marks a parent agency; a
    // managed workspace points at its agency via agency_id (self-referential FK).
    // Application code enforces is_agency XOR agency_id (no nested agencies).
    isAgency: boolean("is_agency").notNull().default(false),
    agencyId: uuid("agency_id").references((): AnyPgColumn => tenants.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("tenants_slug_key").on(t.slug), index("tenants_agency_idx").on(t.agencyId)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    oidcSubject: text("oidc_subject").notNull(),
    email: text("email").notNull(),
    role: userRole("role").notNull().default("member"),
    status: userStatus("status").notNull().default("active"),
    sessionEpoch: integer("session_epoch").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_tenant_subject_key").on(t.tenantId, t.oidcSubject),
    uniqueIndex("users_tenant_email_key").on(t.tenantId, t.email),
    index("users_tenant_idx").on(t.tenantId),
  ],
);

/**
 * Workspace invitations. A pending invite is consumed at the invitee's first
 * OIDC login (email match in src/auth/provision.ts), creating their user in this
 * tenant with the invited role. Partial-unique (one pending per tenant+email)
 * and the email-lookup index live in the SQL migration (Rule 2).
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: userRole("role").notNull().default("member"),
    status: invitationStatus("status").notNull().default("pending"),
    token: text("token").notNull(),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [index("invitations_tenant_idx").on(t.tenantId)],
);

/**
 * Saved views — per-user list presets. `query` is the normalized URL query
 * string a list page reads back through parseListParams. RLS scopes rows to the
 * owning user (tenant_id AND user_id), so presets are private; the unique index
 * (tenant, user, list_key, name) + the RLS policy live in the SQL migration.
 */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listKey: text("list_key").notNull(),
    name: text("name").notNull(),
    query: text("query").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("saved_views_lookup_idx").on(t.tenantId, t.userId, t.listKey)],
);

/**
 * Per-tenant SSO / SCIM config (one row per tenant). `scimTokenHash` is the
 * SHA-256 of the provisioning bearer token; the unique partial index + RLS live
 * in the SQL migration. SAML columns will extend this table later.
 */
export const ssoConfig = pgTable("sso_config", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  scimEnabled: boolean("scim_enabled").notNull().default(false),
  scimTokenHash: text("scim_token_hash"),
  samlEnabled: boolean("saml_enabled").notNull().default(false),
  samlIdpEntityId: text("saml_idp_entity_id"),
  samlIdpSsoUrl: text("saml_idp_sso_url"),
  samlIdpCert: text("saml_idp_cert"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Idempotency ledger for the mutation gate. A (tenant, key) pair stores the
 * first request's hash and its committed response so retries are replayed, not
 * re-executed (Rule 6).
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("idempotency_tenant_key").on(t.tenantId, t.key),
    index("idempotency_tenant_idx").on(t.tenantId),
  ],
);

/**
 * Append-only audit trail. Every gated mutation writes here within the same
 * tenant-scoped transaction, so the audit row is itself RLS-protected.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_tenant_idx").on(t.tenantId),
    index("audit_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

/**
 * Object-storage ledger. Files live in S3-compatible storage; their metadata
 * and — critically — their malware-scan status live HERE in Postgres (Rule 1: no
 * parallel store). Access is fail-closed: an object is downloadable only once a
 * verified scan webhook flips scan_status to 'clean'.
 */
export const storageObjects = pgTable(
  "storage_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    scanStatus: scanStatus("scan_status").notNull().default("pending"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("storage_tenant_key").on(t.tenantId, t.bucket, t.objectKey),
    index("storage_tenant_idx").on(t.tenantId),
  ],
);

// ----------------------------------------------------------------------------
// Readiness Assessments (domain). RLS policies for these live in
// drizzle/0001_assessments.sql and are kept in lockstep with the tables below.
// ----------------------------------------------------------------------------

export const assessmentPreset = pgEnum("assessment_preset", [
  "program_submission",
  "growth_funding",
  "tier_advancement",
  "custom",
]);

export const assessmentStatus = pgEnum("assessment_status", [
  "draft",
  "scored",
]);

export const assessmentModuleEnum = pgEnum("assessment_module", [
  "gtm",
  "competency",
  "specialization",
  "partner_tier",
  "marketplace",
  "mdf",
  "evidence",
]);

export const recommendationType = pgEnum("recommendation_type", [
  "program",
  "evidence_gap",
  "task",
  "milestone",
]);

export const recommendationStatus = pgEnum("recommendation_status", [
  "pending",
  "approved",
  "rejected",
]);

/**
 * A single readiness evaluation. Lives as a 'draft' while the user answers
 * questions, then flips to 'scored' atomically at submit. catalog_version is
 * stamped at create time so scoring stays reproducible across catalog revisions.
 */
export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    preset: assessmentPreset("preset").notNull(),
    targetProgram: text("target_program"),
    status: assessmentStatus("status").notNull().default("draft"),
    catalogVersion: integer("catalog_version").notNull(),
    overallScore: integer("overall_score"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
  },
  (t) => [
    index("assessments_tenant_idx").on(t.tenantId),
    index("assessments_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

/** One row per in-scope module, holding its computed 0–100 score. */
export const assessmentModules = pgTable(
  "assessment_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    module: assessmentModuleEnum("module").notNull(),
    score: integer("score"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("assessment_modules_unique").on(
      t.tenantId,
      t.assessmentId,
      t.module,
    ),
    index("assessment_modules_assessment_idx").on(t.tenantId, t.assessmentId),
  ],
);

/** Saved answers (one per catalog question_key); upserted on every draft save. */
export const assessmentResponses = pgTable(
  "assessment_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    module: assessmentModuleEnum("module").notNull(),
    questionKey: text("question_key").notNull(),
    value: jsonb("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("assessment_responses_unique").on(
      t.tenantId,
      t.assessmentId,
      t.questionKey,
    ),
    index("assessment_responses_assessment_idx").on(t.tenantId, t.assessmentId),
  ],
);

/**
 * Approval-gated downstream actions generated at submit. Each is reviewed by a
 * human (pending -> approved/rejected) before any later domain consumes it.
 */
export const assessmentRecommendations = pgTable(
  "assessment_recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    type: recommendationType("type").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    payload: jsonb("payload").notNull().default({}),
    confidence: integer("confidence").notNull(),
    status: recommendationStatus("status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("assessment_recs_assessment_idx").on(t.tenantId, t.assessmentId),
    index("assessment_recs_status_idx").on(t.tenantId, t.status),
  ],
);

// ----------------------------------------------------------------------------
// Task Manager (domain). RLS in drizzle/0002_tasks.sql, kept in lockstep.
// ----------------------------------------------------------------------------

export const taskStatus = pgEnum("task_status", [
  "open",
  "in_progress",
  "blocked",
  "done",
]);

export const taskPriority = pgEnum("task_priority", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const taskSource = pgEnum("task_source", [
  "manual",
  "assessment",
  "mdf",
  "program",
  "evidence",
  "tier",
  "roadmap",
  "ace",
  "onboarding",
]);

/**
 * The central execution unit. Created directly or spawned from an approved
 * action elsewhere (source + source_ref); a partial unique index on
 * (tenant_id, source, source_ref) prevents duplicate source-linked work.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: taskStatus("status").notNull().default("open"),
    priority: taskPriority("priority").notNull().default("medium"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dueDate: date("due_date"),
    source: taskSource("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    labels: jsonb("labels").notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("tasks_tenant_idx").on(t.tenantId),
    index("tasks_tenant_status_idx").on(t.tenantId, t.status),
    index("tasks_tenant_owner_idx").on(t.tenantId, t.ownerUserId),
    uniqueIndex("tasks_source_ref_unique")
      .on(t.tenantId, t.source, t.sourceRef)
      .where(sql`source_ref IS NOT NULL`),
  ],
);

// ----------------------------------------------------------------------------
// Onboarding (domain). RLS in drizzle/0003_onboarding.sql, kept in lockstep.
// One record per tenant; completion spawns a starter assessment + seeded tasks.
// ----------------------------------------------------------------------------

export const onboardingStatus = pgEnum("onboarding_status", [
  "in_progress",
  "completed",
]);

export const onboardingStep = pgEnum("onboarding_step", [
  "context",
  "objectives",
  "path",
  "review",
  "done",
]);

export const onboardingPath = pgEnum("onboarding_path", [
  "foundations",
  "growth",
  "scale",
]);

export const onboarding = pgTable(
  "onboarding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    status: onboardingStatus("status").notNull().default("in_progress"),
    step: onboardingStep("step").notNull().default("context"),
    companyName: text("company_name"),
    industry: text("industry"),
    partnerType: text("partner_type"),
    awsStage: text("aws_stage"),
    teamSize: text("team_size"),
    objectives: jsonb("objectives").notNull().default([]),
    path: onboardingPath("path"),
    assessmentId: uuid("assessment_id").references(() => assessments.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("onboarding_tenant_unique").on(t.tenantId)],
);

// ----------------------------------------------------------------------------
// Roadmap Builder (domain). RLS in drizzle/0004_roadmaps.sql, kept in lockstep.
// A roadmap sequences milestones; finalizing hands each milestone to Tasks.
// ----------------------------------------------------------------------------

export const roadmapHorizon = pgEnum("roadmap_horizon", [
  "m3",
  "m6",
  "m9",
  "m12",
  "m18",
]);

export const roadmapScenario = pgEnum("roadmap_scenario", [
  "conservative",
  "standard",
  "accelerated",
]);

export const roadmapStatus = pgEnum("roadmap_status", ["draft", "finalized"]);

export const roadmapSource = pgEnum("roadmap_source", [
  "manual",
  "assessment",
  "composed",
]);

export const milestoneStatus = pgEnum("milestone_status", [
  "planned",
  "in_progress",
  "done",
  "blocked",
]);

export const roadmaps = pgTable(
  "roadmaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    objective: text("objective").notNull().default(""),
    horizon: roadmapHorizon("horizon").notNull().default("m6"),
    scenario: roadmapScenario("scenario").notNull().default("standard"),
    startDate: date("start_date").notNull(),
    status: roadmapStatus("status").notNull().default("draft"),
    source: roadmapSource("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("roadmaps_tenant_idx").on(t.tenantId),
    index("roadmaps_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export const roadmapMilestones = pgTable(
  "roadmap_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    roadmapId: uuid("roadmap_id")
      .notNull()
      .references(() => roadmaps.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    targetDate: date("target_date").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dependsOnId: uuid("depends_on_id"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    // Composition origin: which catalog item this milestone advances. 'custom'
    // for manual/assessment-seeded milestones; 'program' / 'tier' when composed.
    originKind: text("origin_kind").notNull().default("custom"),
    originLabel: text("origin_label").notNull().default(""),
    // Per-milestone progress (living plan); editable in any roadmap state.
    status: milestoneStatus("status").notNull().default("planned"),
    // Catalog key this milestone advances: the program library key, or
    // "<tier>:<requirementKey>". Drives finalize-adoption + progress rollback.
    originRef: text("origin_ref").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("roadmap_milestones_roadmap_idx").on(t.tenantId, t.roadmapId),
    uniqueIndex("roadmap_milestones_sequence_unique").on(
      t.tenantId,
      t.roadmapId,
      t.sequence,
    ),
  ],
);

// ----------------------------------------------------------------------------
// Evidence Locker (domain). RLS in drizzle/0005_evidence.sql, kept in lockstep.
// Optional file link to storage_objects; files are fail-closed until scanned.
// ----------------------------------------------------------------------------

export const evidenceType = pgEnum("evidence_type", [
  "case_study",
  "certification",
  "architecture",
  "security",
  "billing",
  "reference",
  "other",
]);

export const evidenceStatus = pgEnum("evidence_status", [
  "missing",
  "collected",
  "in_review",
  "approved",
  "rejected",
]);

export const evidenceSource = pgEnum("evidence_source", [
  "manual",
  "assessment",
  "program",
  "tier",
  "mdf",
]);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    evidenceType: evidenceType("evidence_type").notNull().default("other"),
    status: evidenceStatus("status").notNull().default("missing"),
    program: text("program"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    qualityScore: integer("quality_score"),
    reusable: boolean("reusable").notNull().default(false),
    dueDate: date("due_date"),
    expirationDate: date("expiration_date"),
    reviewNotes: text("review_notes").notNull().default(""),
    fileName: text("file_name"),
    storageObjectId: uuid("storage_object_id").references(
      () => storageObjects.id,
      { onDelete: "set null" },
    ),
    source: evidenceSource("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("evidence_tenant_idx").on(t.tenantId),
    index("evidence_tenant_status_idx").on(t.tenantId, t.status),
    index("evidence_tenant_owner_idx").on(t.tenantId, t.ownerUserId),
    uniqueIndex("evidence_source_ref_unique")
      .on(t.tenantId, t.source, t.sourceRef)
      .where(sql`source_ref IS NOT NULL`),
  ],
);

// ----------------------------------------------------------------------------
// Program Management (domain). RLS in drizzle/0006_programs.sql, in lockstep.
// Adopted from the static library; requirements link to evidence + tasks.
// ----------------------------------------------------------------------------

export const programStatus = pgEnum("program_status", [
  "pending",
  "submitted",
  "active",
  "expired",
]);

export const requirementStatus = pgEnum("requirement_status", [
  "open",
  "met",
  "blocked",
]);

export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    libraryKey: text("library_key").notNull(),
    name: text("name").notNull(),
    programType: text("program_type").notNull(),
    deliveryModel: text("delivery_model").notNull(),
    fundingFit: text("funding_fit").notNull(),
    status: programStatus("status").notNull().default("pending"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    targetDate: date("target_date"),
    expirationDate: date("expiration_date"),
    // Stamped (COALESCE) when status first transitions to "active" — anchors the
    // conservative "won since achieved" ROI influence metric.
    achievedAt: date("achieved_at"),
    notes: text("notes").notNull().default(""),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("programs_tenant_library_unique").on(t.tenantId, t.libraryKey),
    index("programs_tenant_idx").on(t.tenantId),
    index("programs_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export const programRequirements = pgTable(
  "program_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    requirementKey: text("requirement_key").notNull(),
    label: text("label").notNull(),
    expectedEvidenceType: text("expected_evidence_type").notNull(),
    status: requirementStatus("status").notNull().default("open"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    targetDate: date("target_date"),
    evidenceId: uuid("evidence_id").references(() => evidence.id, {
      onDelete: "set null",
    }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("program_requirements_unique").on(
      t.tenantId,
      t.programId,
      t.requirementKey,
    ),
    index("program_requirements_program_idx").on(t.tenantId, t.programId),
  ],
);

// ----------------------------------------------------------------------------
// AWS Competency Applications (domain). RLS in drizzle/0023_competency_applications.sql.
// Upload a Self-Assessment workbook -> per-control AI-drafted Partner Responses
// grounded in the Evidence Locker -> export a filled workbook.
// ----------------------------------------------------------------------------

export const applicationStatus = pgEnum("application_status", [
  "draft",
  "generating",
  "ready",
  "exported",
]);

export const applicationControlStatus = pgEnum("application_control_status", [
  "open",
  "generated",
  "accepted",
  "edited",
]);

export const applicationMet = pgEnum("application_met", [
  "unknown",
  "yes",
  "no",
  "partial",
]);

// The real AWS application status lifecycle (partner-maintained), distinct from
// the internal drafting `application_status`.
export const awsApplicationStatus = pgEnum("aws_application_status", [
  "draft",
  "submitted",
  "in_review",
  "tech_validation_requested",
  "tech_validation_scheduled",
  "tech_validation_in_process",
  "confirmed",
  "declined",
  "expired",
  "pending_partner_action",
  "marketing_update",
  "resubmitted",
  "deleted",
]);

export const competencyApplications = pgTable(
  "competency_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    competency: text("competency").notNull().default(""),
    programType: text("program_type").notNull().default(""),
    sourceStorageObjectId: uuid("source_storage_object_id").references(
      () => storageObjects.id,
      { onDelete: "set null" },
    ),
    sourceFileName: text("source_file_name").notNull().default(""),
    status: applicationStatus("status").notNull().default("draft"),
    controlCount: integer("control_count").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    categories: text("categories").notNull().default(""),
    pocName: text("poc_name").notNull().default(""),
    pocEmail: text("poc_email").notNull().default(""),
    pocRole: text("poc_role").notNull().default(""),
    awsStatus: awsApplicationStatus("aws_status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    solutionId: uuid("solution_id").references(() => solutions.id, { onDelete: "set null" }),
    programId: uuid("program_id").references(() => programs.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("competency_applications_tenant_idx").on(t.tenantId),
    index("competency_applications_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export const applicationControls = pgTable(
  "application_controls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => competencyApplications.id, { onDelete: "cascade" }),
    sheetName: text("sheet_name").notNull(),
    controlId: text("control_id").notNull(),
    requirementText: text("requirement_text").notNull(),
    section: text("section").notNull().default(""),
    responseTarget: jsonb("response_target").notNull().default([]),
    exampleResponse: text("example_response").notNull().default(""),
    recommendedResponse: text("recommended_response").notNull().default(""),
    metSuggestion: applicationMet("met_suggestion").notNull().default("unknown"),
    aiConfidence: integer("ai_confidence").notNull().default(0),
    aiReasoning: text("ai_reasoning").notNull().default(""),
    linkedEvidenceIds: jsonb("linked_evidence_ids").notNull().default([]),
    status: applicationControlStatus("status").notNull().default("open"),
    sequence: integer("sequence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("application_controls_unique").on(
      t.tenantId,
      t.applicationId,
      t.sheetName,
      t.controlId,
    ),
    index("application_controls_app_idx").on(t.tenantId, t.applicationId),
  ],
);

// Tier C: reusable AWS Case Study object (customer-example narrative). RLS in
// drizzle/0026_case_studies.sql, in lockstep.
export const caseStudyVisibility = pgEnum("case_study_visibility", ["private", "public"]);

export const caseStudies = pgTable(
  "case_studies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    customerName: text("customer_name").notNull().default(""),
    anonymized: boolean("anonymized").notNull().default(false),
    visibility: caseStudyVisibility("visibility").notNull().default("private"),
    aboutCustomer: text("about_customer").notNull().default(""),
    challenge: text("challenge").notNull().default(""),
    goals: text("goals").notNull().default(""),
    solution: text("solution").notNull().default(""),
    outcomes: text("outcomes").notNull().default(""),
    url: text("url").notNull().default(""),
    evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("case_studies_tenant_idx").on(t.tenantId)],
);

// Tier C3: ordered attachment of case studies to an application (-> reference cols).
export const applicationCaseStudies = pgTable(
  "application_case_studies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => competencyApplications.id, { onDelete: "cascade" }),
    caseStudyId: uuid("case_study_id")
      .notNull()
      .references(() => caseStudies.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("application_case_studies_unique").on(t.tenantId, t.applicationId, t.caseStudyId),
    index("application_case_studies_app_idx").on(t.tenantId, t.applicationId),
  ],
);

// Curated proof points pinned to a co-sell deal. Relevance itself is derived
// at read time (ace/case-study-match.ts); only the rep's attachments persist.
// RLS in drizzle/0055_opportunity_case_studies.sql, in lockstep.
export const opportunityCaseStudies = pgTable(
  "opportunity_case_studies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    caseStudyId: uuid("case_study_id")
      .notNull()
      .references(() => caseStudies.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("opportunity_case_studies_unique").on(t.tenantId, t.opportunityId, t.caseStudyId),
    index("opportunity_case_studies_opp_idx").on(t.tenantId, t.opportunityId),
  ],
);

// Tier D: AWS Solutions -- the validated unit of a Specialization. RLS in
// drizzle/0028_solutions.sql, in lockstep.
export const solutionTypeEnum = pgEnum("solution_type", [
  "software_product",
  "hardware_product",
  "consulting_service",
  "professional_service",
  "managed_service",
  "training_service",
  "other",
]);
export const solutionAvailabilityEnum = pgEnum("solution_availability", ["available", "beta", "unsupported"]);
export const ftrStatusEnum = pgEnum("ftr_status", ["none", "requested", "approved"]);

export const solutions = pgTable(
  "solutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    solutionType: solutionTypeEnum("solution_type").notNull().default("consulting_service"),
    programType: text("program_type").notNull().default(""),
    description: text("description").notNull().default(""),
    sellingProposition: text("selling_proposition").notNull().default(""),
    availability: solutionAvailabilityEnum("availability").notNull().default("available"),
    ftrStatus: ftrStatusEnum("ftr_status").notNull().default("none"),
    url: text("url").notNull().default(""),
    marketplaceUrl: text("marketplace_url").notNull().default(""),
    renewalDate: date("renewal_date"),
    programId: uuid("program_id").references(() => programs.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("solutions_tenant_idx").on(t.tenantId),
    index("solutions_program_idx").on(t.tenantId, t.programId),
  ],
);

/**
 * Snooze-style dismissal of derived Command Center decisions. decision_id is
 * the deterministic derived id (e.g. "task-overdue-<uuid>"), not an FK —
 * decisions are recomputed per request, so a dismissal filters the derived set
 * until dismissed_until passes. One row per (tenant, decision), reused by
 * upsert; expired rows are inert.
 */
export const decisionDismissals = pgTable(
  "decision_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    decisionId: text("decision_id").notNull(),
    dismissedUntil: date("dismissed_until").notNull(),
    dismissedBy: uuid("dismissed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("decision_dismissals_unique").on(t.tenantId, t.decisionId),
    index("decision_dismissals_until_idx").on(t.tenantId, t.dismissedUntil),
  ],
);

// ----------------------------------------------------------------------------
// Partner Tier Management (domain). RLS in drizzle/0007_tiers.sql, in lockstep.
// One plan per tenant; an approved advancement updates tenants.tier.
// ----------------------------------------------------------------------------

export const tierPlanStatus = pgEnum("tier_plan_status", ["active", "achieved"]);

export const tierPlans = pgTable(
  "tier_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    currentTier: partnerTier("current_tier").notNull(),
    targetTier: partnerTier("target_tier").notNull(),
    status: tierPlanStatus("status").notNull().default("active"),
    catalogVersion: integer("catalog_version").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    targetDate: date("target_date"),
    notes: text("notes").notNull().default(""),
    achievedAt: timestamp("achieved_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("tier_plans_tenant_unique").on(t.tenantId)],
);

export const tierRequirements = pgTable(
  "tier_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => tierPlans.id, { onDelete: "cascade" }),
    requirementKey: text("requirement_key").notNull(),
    label: text("label").notNull(),
    category: text("category").notNull(),
    unit: text("unit").notNull(),
    threshold: integer("threshold").notNull(),
    currentValue: integer("current_value").notNull().default(0),
    // Catalog v2: requirement kind + an optional secondary numeric gate + a human
    // constraint note + an informational (context-only) flag.
    kind: text("kind").notNull().default("count"),
    secondaryLabel: text("secondary_label"),
    secondaryUnit: text("secondary_unit"),
    secondaryThreshold: integer("secondary_threshold"),
    secondaryCurrentValue: integer("secondary_current_value").notNull().default(0),
    note: text("note").notNull().default(""),
    informational: boolean("informational").notNull().default(false),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    targetDate: date("target_date"),
    evidenceId: uuid("evidence_id").references(() => evidence.id, {
      onDelete: "set null",
    }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("tier_requirements_unique").on(
      t.tenantId,
      t.planId,
      t.requirementKey,
    ),
    index("tier_requirements_plan_idx").on(t.tenantId, t.planId),
  ],
);

// ----------------------------------------------------------------------------
// MDF Management (domain). RLS in drizzle/0008_mdf.sql, kept in lockstep.
// One row per request, carrying amounts at each lifecycle stage.
// ----------------------------------------------------------------------------

export const mdfActivityType = pgEnum("mdf_activity_type", [
  "event",
  "campaign",
  "content",
  "enablement",
  "other",
]);

export const mdfStatus = pgEnum("mdf_status", [
  "draft",
  "requested",
  "approved",
  "rejected",
  "deployed",
  "claimed",
  "reimbursed",
]);

export const mdfRequests = pgTable(
  "mdf_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    activityType: mdfActivityType("activity_type").notNull().default("other"),
    status: mdfStatus("status").notNull().default("draft"),
    currency: text("currency").notNull().default("USD"),
    requestedAmount: integer("requested_amount").notNull().default(0),
    approvedAmount: integer("approved_amount"),
    deployedAmount: integer("deployed_amount"),
    claimedAmount: integer("claimed_amount"),
    reimbursedAmount: integer("reimbursed_amount"),
    expectedPipeline: integer("expected_pipeline").notNull().default(0),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startDate: date("start_date"),
    endDate: date("end_date"),
    claimDeadline: date("claim_deadline"),
    opportunityRef: text("opportunity_ref"),
    // Trustworthy MDF -> opportunity link (drizzle/0049) for realized ROI attribution.
    // Backfilled from opportunityRef; the free-text ref stays for display/back-compat.
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    // AWS activity-catalog grounding (drizzle/0036): the chosen catalog activity,
    // the full activity cost (requestedAmount is the AWS ask), and a branding ack.
    catalogKey: text("catalog_key"),
    totalCost: integer("total_cost"),
    awsBrandingConfirmed: boolean("aws_branding_confirmed").notNull().default(false),
    evidenceId: uuid("evidence_id").references(() => evidence.id, {
      onDelete: "set null",
    }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    reviewNotes: text("review_notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mdf_requests_tenant_idx").on(t.tenantId),
    index("mdf_requests_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

// Per-period MDF budget allocation (drives budget-vs-committed on the overview).
export const mdfBudgets = pgTable(
  "mdf_budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    periodLabel: text("period_label").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mdf_budgets_tenant_idx").on(t.tenantId)],
);

// Daily MDF portfolio snapshot (materialize-on-read) for hero sparklines/deltas.
export const mdfSnapshots = pgTable(
  "mdf_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    capturedOn: date("captured_on").notNull(),
    approved: bigint("approved", { mode: "number" }).notNull().default(0),
    deployed: bigint("deployed", { mode: "number" }).notNull().default(0),
    claimed: bigint("claimed", { mode: "number" }).notNull().default(0),
    reimbursed: bigint("reimbursed", { mode: "number" }).notNull().default(0),
    pipeline: bigint("pipeline", { mode: "number" }).notNull().default(0),
    openCount: integer("open_count").notNull().default(0),
    deadlineRisks: integer("deadline_risks").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mdf_snapshots_tenant_day_key").on(t.tenantId, t.capturedOn)],
);

// MDF marketing event planner (drizzle/0036): a saved plan of candidate events.
export const mdfEventPlans = pgTable(
  "mdf_event_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mdf_event_plans_tenant_idx").on(t.tenantId)],
);

// Candidate events within a plan; convert links back to the spawned request.
export const mdfPlanItems = pgTable(
  "mdf_plan_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => mdfEventPlans.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    catalogKey: text("catalog_key"),
    activityType: mdfActivityType("activity_type").notNull().default("other"),
    totalCost: integer("total_cost").notNull().default(0),
    coFundPct: integer("co_fund_pct").notNull().default(50),
    expectedPipeline: integer("expected_pipeline").notNull().default(0),
    expectedOpportunities: integer("expected_opportunities").notNull().default(0),
    startDate: date("start_date"),
    endDate: date("end_date"),
    spmsId: text("spms_id"),
    requestId: uuid("request_id").references(() => mdfRequests.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mdf_plan_items_tenant_plan_idx").on(t.tenantId, t.planId)],
);

// ----------------------------------------------------------------------------
// ACE Intelligence (domain). RLS in drizzle/0009_ace.sql, kept in lockstep.
// Opportunities route to internal reps; approving routing spawns a Task.
// ----------------------------------------------------------------------------

export const opportunityStage = pgEnum("opportunity_stage", [
  "prospect",
  "qualified",
  "tech_validation",
  "business_validation",
  "committed",
  "launched",
  "closed_lost",
]);

export const opportunityStatus = pgEnum("opportunity_status", [
  "open",
  "won",
  "lost",
]);

export const opportunitySource = pgEnum("opportunity_source", [
  "partner_originated",
  "amazon_originated",
  "marketplace",
]);

export const routingStatus = pgEnum("routing_status", [
  "unrouted",
  "routed",
  "approved",
]);

export const relationshipRole = pgEnum("relationship_role", [
  "seller",
  "solutions_architect",
  "partner_manager",
  "leadership",
  "other",
]);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    accountName: text("account_name").notNull().default(""),
    stage: opportunityStage("stage").notNull().default("prospect"),
    status: opportunityStatus("status").notNull().default("open"),
    amount: integer("amount").notNull().default(0),
    source: opportunitySource("source").notNull().default("partner_originated"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    awsSeller: text("aws_seller"),
    awsContactId: uuid("aws_contact_id").references(() => aceRelationships.id, {
      onDelete: "set null",
    }),
    solutionId: uuid("solution_id").references(() => solutions.id, { onDelete: "set null" }),
    // The Competency this deal is credited to for ROI (single primary). NULL = untagged.
    programId: uuid("program_id").references(() => programs.id, { onDelete: "set null" }),
    // AWS-referred opp identity (from Partner Central) + insight snapshot. Manual opps
    // leave external_id NULL so they never collide with synced ones.
    externalId: text("external_id"),
    awsEngagementScore: text("aws_engagement_score").notNull().default(""),
    awsNextBestActions: text("aws_next_best_actions").notNull().default(""),
    nextStep: text("next_step").notNull().default(""),
    lastInteraction: date("last_interaction"),
    closeDate: date("close_date"),
    // Win/loss mining (drizzle/0051): why a deal was lost (app-validated catalog;
    // '' = not recorded) + the ACTUAL close timestamp (closeDate stays the target).
    lossReason: text("loss_reason").notNull().default(""),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    routingStatus: routingStatus("routing_status").notNull().default("unrouted"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("opportunities_tenant_idx").on(t.tenantId),
    index("opportunities_tenant_status_idx").on(t.tenantId, t.status),
    index("opportunities_tenant_owner_idx").on(t.tenantId, t.ownerUserId),
    index("opportunities_tenant_external_idx").on(t.tenantId, t.externalId),
    index("opportunities_tenant_program_idx").on(t.tenantId, t.programId),
  ],
);

export const aceRelationships = pgTable(
  "ace_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: relationshipRole("role").notNull().default("seller"),
    accountName: text("account_name").notNull().default(""),
    // Dedup key for AWS people synced from Partner Central (manual rels keep '').
    email: text("email").notNull().default(""),
    strength: integer("strength").notNull().default(0),
    lastContact: date("last_contact"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ace_relationships_tenant_idx").on(t.tenantId),
    index("ace_relationships_tenant_account_idx").on(t.tenantId, t.accountName),
    index("ace_relationships_tenant_email_idx").on(t.tenantId, t.email),
  ],
);

export const interactionType = pgEnum("interaction_type", [
  "meeting",
  "email",
  "call",
  "qbr",
  "note",
]);

// Touchpoint log with an AWS contact. Logging an interaction bumps the contact's
// last_contact (see logInteractionOp), so relationship-health recency stays current.
export const aceInteractions = pgTable(
  "ace_interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => aceRelationships.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    occurredOn: date("occurred_on").notNull(),
    kind: interactionType("kind").notNull().default("meeting"),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ace_interactions_tenant_idx").on(t.tenantId),
    index("ace_interactions_contact_idx").on(t.tenantId, t.contactId),
  ],
);

// AWS team titles from Partner Central GetAwsOpportunitySummary OpportunityTeam.
export const awsOrgTitle = pgEnum("aws_org_title", [
  "aws_sales_rep",
  "aws_account_owner",
  "wwps_pdm",
  "pdm",
  "psm",
  "isv_sm",
]);

// Which AWS person (an ace_relationships row, deduped by email) holds which AWS title
// on which opportunity. Populated by the Partner Central team sync; powers per-rep
// open-opp counts + closed-won TCV + coverage rollups. RLS in drizzle/0029.
export const opportunityAwsTeam = pgTable(
  "opportunity_aws_team",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    relationshipId: uuid("relationship_id")
      .notNull()
      .references(() => aceRelationships.id, { onDelete: "cascade" }),
    title: awsOrgTitle("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("opp_aws_team_unique").on(t.tenantId, t.opportunityId, t.relationshipId, t.title),
    index("opp_aws_team_opp_idx").on(t.tenantId, t.opportunityId),
    index("opp_aws_team_rel_idx").on(t.tenantId, t.relationshipId),
  ],
);

// ----------------------------------------------------------------------------
// AWS Partner Central connector + co-sell mirror. RLS in
// drizzle/0018_aws_partner_central.sql, kept in lockstep. aws_connection holds
// the per-tenant cross-account IAM role (assumed via STS); the mirror table is a
// READ-ONLY copy of Partner Central opportunities (native `opportunities` remain
// the editable source of record). Reuses the opportunityStage/Status enums.
// ----------------------------------------------------------------------------

export const awsConnection = pgTable("aws_connection", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  roleArn: text("role_arn").notNull().default(""),
  externalId: text("external_id").notNull().default(""),
  region: text("region").notNull().default("us-east-1"),
  catalog: text("catalog").notNull().default("Sandbox"),
  enabled: boolean("enabled").notNull().default(false),
  // Opt-in: pull the per-opp AWS team via GetAwsOpportunitySummary (N GETs per sync).
  enrichTeam: boolean("enrich_team").notNull().default(false),
  status: text("status").notNull().default("not_configured"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  // AWS Marketplace connector (drizzle/0043). Toggles independently of Partner Central
  // against the same cross-account role. AWS is the source of truth for Marketplace data.
  marketplaceEnabled: boolean("marketplace_enabled").notNull().default(false),
  sellerId: text("seller_id").notNull().default(""),
  marketplaceStatus: text("marketplace_status").notNull().default("not_configured"),
  marketplaceLastSyncedAt: timestamp("marketplace_last_synced_at", { withTimezone: true }),
  marketplaceLastError: text("marketplace_last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const partnerCentralOpportunities = pgTable(
  "partner_central_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull().default(""),
    accountName: text("account_name").notNull().default(""),
    stage: opportunityStage("stage").notNull().default("prospect"),
    status: opportunityStatus("status").notNull().default("open"),
    amount: integer("amount").notNull().default(0),
    awsStageRaw: text("aws_stage_raw").notNull().default(""),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pc_opps_tenant_external_idx").on(t.tenantId, t.externalId),
    index("pc_opps_tenant_idx").on(t.tenantId),
    index("pc_opps_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

// ----------------------------------------------------------------------------
// Reporting (domain). RLS in drizzle/0010_reports.sql, kept in lockstep. The
// jsonb snapshot is a point-in-time aggregate across every section.
// ----------------------------------------------------------------------------

export const reportType = pgEnum("report_type", [
  "executive_plan",
  "qbr",
  "mdf_performance",
  "ace_contribution",
  "program_readiness",
  "tier_evidence",
  "custom",
]);

export const reportStatus = pgEnum("report_status", [
  "draft",
  "reviewed",
  "approved",
  "exported",
]);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    reportType: reportType("report_type").notNull().default("executive_plan"),
    status: reportStatus("status").notNull().default("draft"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    snapshot: jsonb("snapshot").notNull().default({}),
    summary: text("summary").notNull().default(""),
    // Saved executive narrative (drizzle/0052) — drafted while in draft, frozen by the
    // lifecycle, cleared on snapshot regeneration.
    narrative: text("narrative").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("reports_tenant_idx").on(t.tenantId),
    index("reports_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

// Dense daily metric history (Tier 3) — one row per tenant per day, upserted on
// dashboard load; powers the workspace-home KPI sparklines. RLS in
// drizzle/0031_metric_snapshots.sql, in lockstep.
export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    capturedOn: date("captured_on").notNull(),
    openWork: integer("open_work").notNull().default(0),
    overdue: integer("overdue").notNull().default(0),
    activePrograms: integer("active_programs").notNull().default(0),
    programsTotal: integer("programs_total").notNull().default(0),
    tierPercent: integer("tier_percent"),
    healthScore: integer("health_score").notNull().default(0),
    marketplacePublished: integer("marketplace_published").notNull().default(0),
    marketplaceActiveEntitlements: integer("marketplace_active_entitlements").notNull().default(0),
    marketplaceAttributedRevenueCents: bigint("marketplace_attributed_revenue_cents", { mode: "number" })
      .notNull()
      .default(0),
    // Additional benchmarkable metrics (drizzle/0047). Nullable win-rate/ROI = "n/a".
    winRatePercent: integer("win_rate_percent"),
    evidencePercent: integer("evidence_percent").notNull().default(0),
    mdfRoiX100: integer("mdf_roi_x100"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("metric_snapshots_tenant_day_key").on(t.tenantId, t.capturedOn)],
);

// Per-roadmap daily burn-up history for the Trajectory forecast — one row per
// (tenant, roadmap, day), upserted on roadmap detail load. RLS in
// drizzle/0038_roadmap_snapshots.sql, kept in lockstep with this definition.
export const roadmapSnapshots = pgTable(
  "roadmap_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    roadmapId: uuid("roadmap_id")
      .notNull()
      .references(() => roadmaps.id, { onDelete: "cascade" }),
    capturedOn: date("captured_on").notNull(),
    done: integer("done").notNull().default(0),
    total: integer("total").notNull().default(0),
    overdue: integer("overdue").notNull().default(0),
    inProgress: integer("in_progress").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roadmap_snapshots_roadmap_day_key").on(t.tenantId, t.roadmapId, t.capturedOn),
  ],
);
export type RoadmapSnapshot = typeof roadmapSnapshots.$inferSelect;

// Co-Selling Goals: org-set targets for the AWS co-sell relationship, tracked on
// the ACE page. RLS in drizzle/0034_ace_goals.sql, lockstep. target_value is
// bigint (revenue targets can exceed the 2.1B integer ceiling).
export const aceGoals = pgTable(
  "ace_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(),
    targetValue: bigint("target_value", { mode: "number" }).notNull(),
    periodStart: date("period_start").notNull(),
    targetDeadline: date("target_deadline"),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ace_goals_tenant_idx").on(t.tenantId)],
);

// Daily progress series per goal for the trend sparkline; materialized-on-read on
// ACE load (idempotent via the tenant/goal/day unique index).
export const aceGoalSnapshots = pgTable(
  "ace_goal_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => aceGoals.id, { onDelete: "cascade" }),
    capturedOn: date("captured_on").notNull(),
    currentValue: bigint("current_value", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ace_goal_snapshots_goal_day_key").on(t.tenantId, t.goalId, t.capturedOn)],
);

// ----------------------------------------------------------------------------
// Settings & Integrations (domain). RLS in drizzle/0011_settings.sql, lockstep.
// One settings row per tenant; one connector per (tenant, kind).
// ----------------------------------------------------------------------------

export const automationMode = pgEnum("automation_mode", [
  "off",
  "recommend_only",
  "auto_with_approval",
  "autonomous",
]);

export const connectorKind = pgEnum("connector_kind", [
  "ace",
  "salesforce",
  "marketplace",
  "aws_context",
  "mdf_import",
  "csv",
  "notetaker",
]);

export const connectorStatus = pgEnum("connector_status", [
  "not_configured",
  "configured",
  "disabled",
  "error",
]);

export const workspaceSettings = pgTable(
  "workspace_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull().default(""),
    automationMode: automationMode("automation_mode").notNull().default("recommend_only"),
    emailNotifications: boolean("email_notifications").notNull().default(true),
    // Reciprocal opt-in to cross-tenant benchmarking (drizzle/0047).
    benchmarkParticipation: boolean("benchmark_participation").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("workspace_settings_tenant_unique").on(t.tenantId)],
);

export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: connectorKind("kind").notNull(),
    status: connectorStatus("status").notNull().default("not_configured"),
    authMode: text("auth_mode").notNull().default(""),
    endpoint: text("endpoint").notNull().default(""),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("connectors_tenant_kind_unique").on(t.tenantId, t.kind),
    index("connectors_tenant_idx").on(t.tenantId),
  ],
);

// ----------------------------------------------------------------------------
// Demo requests (marketing). RLS-FREE and tenant-FREE by design: these are
// vendor-level sales leads captured by the public landing form via withSystem.
// Lockstep migration: drizzle/0032_demo_requests.sql.
// ----------------------------------------------------------------------------

export const demoRequests = pgTable(
  "demo_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    company: text("company").notNull(),
    teamSize: text("team_size"),
    message: text("message"),
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("demo_requests_created_idx").on(t.createdAt)],
);

// ----------------------------------------------------------------------------
// AWS Marketplace (domain). AWS is the source of truth: these tables are a synced
// mirror projection of the Catalog/Metering/Entitlement/Agreement/Reporting APIs;
// listing edits are written through to AWS via Catalog ChangeSets. RLS in
// drizzle/0040-0043, kept in lockstep. Money in integer cents (bigint for snapshot
// aggregates). Reuses the per-tenant awsConnection (assumed via STS).
// ----------------------------------------------------------------------------

export const marketplaceProductType = pgEnum("marketplace_product_type", [
  "saas",
  "ami",
  "container",
  "machine_learning",
  "professional_services",
]);
export const marketplaceVisibility = pgEnum("marketplace_visibility", [
  "limited",
  "public",
  "restricted",
]);
export const marketplaceListingStatus = pgEnum("marketplace_listing_status", [
  "draft",
  "published",
  "changing",
  "archived",
]);
export const marketplaceDimensionType = pgEnum("marketplace_dimension_type", ["contract", "usage"]);
export const marketplaceChangeIntent = pgEnum("marketplace_change_intent", [
  "create",
  "update_details",
  "add_dimension",
  "update_dimension",
  "update_visibility",
  "publish",
]);
export const marketplaceChangeStatus = pgEnum("marketplace_change_status", [
  "preparing",
  "applying",
  "succeeded",
  "failed",
  "cancelled",
]);
export const marketplaceMeteringStatus = pgEnum("marketplace_metering_status", [
  "pending",
  "accepted",
  "rejected",
]);
export const marketplaceAttributionMethod = pgEnum("marketplace_attribution_method", [
  "marketplace_metering",
  "resource_tagging",
  "user_agent",
]);
export const marketplaceAttributionStatus = pgEnum("marketplace_attribution_status", [
  "configured",
  "active",
  "inactive",
]);

export const marketplaceListings = pgTable(
  "marketplace_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(),
    productCode: text("product_code").notNull().default(""),
    title: text("title").notNull(),
    productType: marketplaceProductType("product_type").notNull().default("saas"),
    visibility: marketplaceVisibility("visibility").notNull().default("limited"),
    status: marketplaceListingStatus("status").notNull().default("draft"),
    description: text("description").notNull().default(""),
    solutionId: uuid("solution_id").references(() => solutions.id, { onDelete: "set null" }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("marketplace_listings_entity_idx").on(t.tenantId, t.entityId),
    index("marketplace_listings_tenant_idx").on(t.tenantId),
  ],
);

export const marketplacePricingDimensions = pgTable(
  "marketplace_pricing_dimensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => marketplaceListings.id, { onDelete: "cascade" }),
    apiName: text("api_name").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default(""),
    price: integer("price").notNull().default(0),
    dimensionType: marketplaceDimensionType("dimension_type").notNull().default("usage"),
    restricted: boolean("restricted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("marketplace_dimensions_unique").on(t.tenantId, t.listingId, t.apiName),
    index("marketplace_dimensions_listing_idx").on(t.tenantId, t.listingId),
  ],
);

export const marketplaceChangeSets = pgTable(
  "marketplace_change_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    changeSetId: text("change_set_id").notNull().default(""),
    listingId: uuid("listing_id").references(() => marketplaceListings.id, { onDelete: "cascade" }),
    intent: marketplaceChangeIntent("intent").notNull(),
    status: marketplaceChangeStatus("status").notNull().default("preparing"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error").notNull().default(""),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("marketplace_change_sets_listing_idx").on(t.tenantId, t.listingId),
    index("marketplace_change_sets_tenant_idx").on(t.tenantId),
  ],
);

export const marketplaceCustomers = pgTable(
  "marketplace_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerIdentifier: text("customer_identifier").notNull(),
    customerAwsAccountId: text("customer_aws_account_id").notNull().default(""),
    productCode: text("product_code").notNull().default(""),
    listingId: uuid("listing_id").references(() => marketplaceListings.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("marketplace_customers_unique").on(t.tenantId, t.customerIdentifier),
    index("marketplace_customers_tenant_idx").on(t.tenantId),
  ],
);

export const marketplaceMeteringRecords = pgTable(
  "marketplace_metering_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => marketplaceListings.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    customerIdentifier: text("customer_identifier").notNull().default(""),
    quantity: integer("quantity").notNull().default(0),
    usageTimestamp: timestamp("usage_timestamp", { withTimezone: true }).notNull().defaultNow(),
    status: marketplaceMeteringStatus("status").notNull().default("pending"),
    meteringRecordId: text("metering_record_id").notNull().default(""),
    result: text("result").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("marketplace_metering_listing_idx").on(t.tenantId, t.listingId),
    index("marketplace_metering_tenant_idx").on(t.tenantId),
  ],
);

export const marketplaceEntitlements = pgTable(
  "marketplace_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entitlementId: text("entitlement_id").notNull(),
    listingId: uuid("listing_id").references(() => marketplaceListings.id, { onDelete: "set null" }),
    customerIdentifier: text("customer_identifier").notNull().default(""),
    dimension: text("dimension").notNull().default(""),
    value: integer("value").notNull().default(0),
    expirationDate: date("expiration_date"),
    agreementId: text("agreement_id").notNull().default(""),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("marketplace_entitlements_unique").on(t.tenantId, t.entitlementId),
    index("marketplace_entitlements_listing_idx").on(t.tenantId, t.listingId),
  ],
);

export const marketplaceAgreements = pgTable(
  "marketplace_agreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agreementId: text("agreement_id").notNull(),
    listingId: uuid("listing_id").references(() => marketplaceListings.id, { onDelete: "set null" }),
    customerIdentifier: text("customer_identifier").notNull().default(""),
    offerType: text("offer_type").notNull().default(""),
    status: text("status").notNull().default(""),
    startDate: date("start_date"),
    endDate: date("end_date"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    totalValue: integer("total_value").notNull().default(0),
    acceptanceTime: timestamp("acceptance_time", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("marketplace_agreements_unique").on(t.tenantId, t.agreementId),
    index("marketplace_agreements_listing_idx").on(t.tenantId, t.listingId),
  ],
);

// Co-sell <-> Marketplace private-offer bridge (drizzle/0050). A partner-drafted
// private offer linking an ACE opportunity to the eventual Marketplace agreement it
// closes as. agreementId is null until the offer reconciles to a synced agreement.
export const privateOfferStatus = pgEnum("private_offer_status", [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
]);

export const marketplacePrivateOffers = pgTable(
  "marketplace_private_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // The co-sell deal this offer closes — the bridge to ACE.
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    listingId: uuid("listing_id").references(() => marketplaceListings.id, { onDelete: "set null" }),
    // The reconciled AWS agreement (the transaction); null until the offer is accepted.
    agreementId: uuid("agreement_id").references(() => marketplaceAgreements.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    customerIdentifier: text("customer_identifier").notNull().default(""),
    customerName: text("customer_name").notNull().default(""),
    offerValue: integer("offer_value").notNull().default(0),
    discountPct: integer("discount_pct").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    status: privateOfferStatus("status").notNull().default("draft"),
    expirationDate: date("expiration_date"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    notes: text("notes").notNull().default(""),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("marketplace_private_offers_tenant_idx").on(t.tenantId),
    index("marketplace_private_offers_tenant_status_idx").on(t.tenantId, t.status),
    index("marketplace_private_offers_tenant_opp_idx").on(t.tenantId, t.opportunityId),
  ],
);

export type MarketplacePrivateOffer = typeof marketplacePrivateOffers.$inferSelect;
export type NewMarketplacePrivateOffer = typeof marketplacePrivateOffers.$inferInsert;

export const marketplaceCharges = pgTable(
  "marketplace_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    chargeRef: text("charge_ref").notNull().default(""),
    agreementId: text("agreement_id").notNull().default(""),
    listingId: uuid("listing_id").references(() => marketplaceListings.id, { onDelete: "set null" }),
    billingPeriodStart: date("billing_period_start"),
    billingPeriodEnd: date("billing_period_end"),
    dimension: text("dimension").notNull().default(""),
    quantity: integer("quantity").notNull().default(0),
    amount: integer("amount").notNull().default(0),
    invoiceLineItem: text("invoice_line_item").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("marketplace_charges_unique").on(t.tenantId, t.chargeRef),
    index("marketplace_charges_agreement_idx").on(t.tenantId, t.agreementId),
    index("marketplace_charges_listing_idx").on(t.tenantId, t.listingId),
  ],
);

export const marketplaceAttributionConfig = pgTable(
  "marketplace_attribution_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => marketplaceListings.id, { onDelete: "cascade" }),
    method: marketplaceAttributionMethod("method").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    status: marketplaceAttributionStatus("status").notNull().default("inactive"),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("marketplace_attribution_config_unique").on(t.tenantId, t.listingId, t.method),
    index("marketplace_attribution_config_listing_idx").on(t.tenantId, t.listingId),
  ],
);

export const marketplaceAttributions = pgTable(
  "marketplace_attributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    attributionRef: text("attribution_ref").notNull(),
    listingId: uuid("listing_id").references(() => marketplaceListings.id, { onDelete: "set null" }),
    awsService: text("aws_service").notNull().default(""),
    billingPeriod: text("billing_period").notNull().default(""),
    amount: integer("amount").notNull().default(0),
    method: marketplaceAttributionMethod("method").notNull().default("marketplace_metering"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("marketplace_attributions_unique").on(t.tenantId, t.attributionRef),
    index("marketplace_attributions_listing_idx").on(t.tenantId, t.listingId),
  ],
);

export const marketplaceRevenueSnapshots = pgTable(
  "marketplace_revenue_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    capturedOn: date("captured_on").notNull(),
    listings: integer("listings").notNull().default(0),
    published: integer("published").notNull().default(0),
    activeEntitlements: integer("active_entitlements").notNull().default(0),
    meteredUsageCents: bigint("metered_usage_cents", { mode: "number" }).notNull().default(0),
    attributedRevenueCents: bigint("attributed_revenue_cents", { mode: "number" }).notNull().default(0),
    mrrCents: bigint("mrr_cents", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("marketplace_revenue_snapshots_unique").on(t.tenantId, t.capturedOn)],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type StorageObject = typeof storageObjects.$inferSelect;
export type NewStorageObject = typeof storageObjects.$inferInsert;
export type Assessment = typeof assessments.$inferSelect;
export type NewAssessment = typeof assessments.$inferInsert;
export type AssessmentModuleRow = typeof assessmentModules.$inferSelect;
export type AssessmentResponse = typeof assessmentResponses.$inferSelect;
export type AssessmentRecommendation =
  typeof assessmentRecommendations.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Onboarding = typeof onboarding.$inferSelect;
export type NewOnboarding = typeof onboarding.$inferInsert;
export type Roadmap = typeof roadmaps.$inferSelect;
export type NewRoadmap = typeof roadmaps.$inferInsert;
export type RoadmapMilestone = typeof roadmapMilestones.$inferSelect;
export type NewRoadmapMilestone = typeof roadmapMilestones.$inferInsert;
export type Evidence = typeof evidence.$inferSelect;
export type NewEvidence = typeof evidence.$inferInsert;
export type Program = typeof programs.$inferSelect;
export type NewProgram = typeof programs.$inferInsert;
export type ProgramRequirement = typeof programRequirements.$inferSelect;
export type NewProgramRequirement = typeof programRequirements.$inferInsert;
export type TierPlan = typeof tierPlans.$inferSelect;
export type NewTierPlan = typeof tierPlans.$inferInsert;
export type TierRequirement = typeof tierRequirements.$inferSelect;
export type NewTierRequirement = typeof tierRequirements.$inferInsert;
export type MdfRequest = typeof mdfRequests.$inferSelect;
export type NewMdfRequest = typeof mdfRequests.$inferInsert;
export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
export type AceRelationship = typeof aceRelationships.$inferSelect;
export type NewAceRelationship = typeof aceRelationships.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type WorkspaceSettings = typeof workspaceSettings.$inferSelect;
export type NewWorkspaceSettings = typeof workspaceSettings.$inferInsert;
export type Connector = typeof connectors.$inferSelect;
export type NewConnector = typeof connectors.$inferInsert;
export type DemoRequest = typeof demoRequests.$inferSelect;
export type NewDemoRequest = typeof demoRequests.$inferInsert;

// ---------------------------------------------------------------------------
// AWS Funding (drizzle/0045): applications to AWS partner funding programs
// (MAP, POC credits, ISV Workload Migration, PIF/SIF, WAFR, OLA, ...). MDF is a
// separate deep section; this tracks submissions to the other programs.
// ---------------------------------------------------------------------------
export const fundingStatus = pgEnum("funding_status", [
  "draft",
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "funded",
  "withdrawn",
]);
export const fundingTypeEnum = pgEnum("funding_type", ["cash", "credits"]);

export const fundingSubmissions = pgTable(
  "funding_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    programKey: text("program_key").notNull(),
    title: text("title").notNull(),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    status: fundingStatus("status").notNull().default("draft"),
    fundingType: fundingTypeEnum("funding_type").notNull().default("cash"),
    workloadType: text("workload_type").notNull().default(""),
    customerSegment: text("customer_segment").notNull().default(""),
    requestedAmount: integer("requested_amount").notNull().default(0),
    approvedAmount: integer("approved_amount"),
    currency: text("currency").notNull().default("USD"),
    externalRef: text("external_ref").notNull().default(""),
    deadline: date("deadline"),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    decisionNotes: text("decision_notes").notNull().default(""),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("funding_submissions_tenant_idx").on(t.tenantId),
    index("funding_submissions_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export type FundingSubmission = typeof fundingSubmissions.$inferSelect;
export type NewFundingSubmission = typeof fundingSubmissions.$inferInsert;

// ---------------------------------------------------------------------------
// Automation & Playbook engine (drizzle/0046). Rules that fire actions off the
// cross-domain decision queue, gated by automation_mode; runs are a fire-once
// ledger; notifications are persisted + deliverable (in-app/email/webhook).
// trigger/action/status kept as text so new situations/actions need no migration.
// ---------------------------------------------------------------------------
export const playbooks = pgTable(
  "playbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    triggerSituation: text("trigger_situation").notNull(),
    triggerMinSeverity: text("trigger_min_severity").notNull().default("medium"),
    condition: jsonb("condition").$type<Record<string, unknown>>().notNull().default({}),
    actionType: text("action_type").notNull(),
    actionParams: jsonb("action_params").$type<Record<string, unknown>>().notNull().default({}),
    channels: jsonb("channels").$type<string[]>().notNull().default(["in_app"]),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("playbooks_tenant_idx").on(t.tenantId),
    index("playbooks_tenant_enabled_idx").on(t.tenantId, t.enabled),
  ],
);
export type Playbook = typeof playbooks.$inferSelect;
export type NewPlaybook = typeof playbooks.$inferInsert;

export const playbookRuns = pgTable(
  "playbook_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    playbookId: uuid("playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "cascade" }),
    decisionId: text("decision_id").notNull(),
    decision: jsonb("decision").$type<Record<string, unknown>>().notNull().default({}),
    verdict: text("verdict").notNull(),
    status: text("status").notNull().default("recommended"),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("playbook_runs_fire_once").on(t.tenantId, t.playbookId, t.decisionId),
    index("playbook_runs_tenant_status_idx").on(t.tenantId, t.status),
  ],
);
export type PlaybookRun = typeof playbookRuns.$inferSelect;
export type NewPlaybookRun = typeof playbookRuns.$inferInsert;

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("playbook"),
    playbookRunId: uuid("playbook_run_id").references(() => playbookRuns.id, {
      onDelete: "set null",
    }),
    severity: text("severity").notNull().default("medium"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link").notNull().default(""),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    emailStatus: text("email_status").notNull().default("none"),
    webhookStatus: text("webhook_status").notNull().default("none"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe").on(t.tenantId, t.dedupeKey),
    index("notifications_tenant_user_read_idx").on(t.tenantId, t.userId, t.readAt),
  ],
);
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export const notificationWebhooks = pgTable(
  "notification_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notification_webhooks_tenant_idx").on(t.tenantId)],
);
export type NotificationWebhook = typeof notificationWebhooks.$inferSelect;
export type NewNotificationWebhook = typeof notificationWebhooks.$inferInsert;

// ---------------------------------------------------------------------------
// Cross-tenant benchmarking (drizzle/0047). Anonymized cohort percentiles — NO
// tenant_id; one row per (dimension, cohort, metric, day). Written only by the
// system aggregation job (withSystem owner); readable by any tenant (aggregates
// are non-identifying). k-anonymity (>= 5) enforced in the aggregation code.
// ---------------------------------------------------------------------------
export const benchmarkCohorts = pgTable(
  "benchmark_cohorts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cohortDimension: text("cohort_dimension").notNull(),
    cohortValue: text("cohort_value").notNull(),
    metric: text("metric").notNull(),
    capturedOn: date("captured_on").notNull(),
    p25: bigint("p25", { mode: "number" }).notNull().default(0),
    p50: bigint("p50", { mode: "number" }).notNull().default(0),
    p75: bigint("p75", { mode: "number" }).notNull().default(0),
    p90: bigint("p90", { mode: "number" }).notNull().default(0),
    sampleCount: integer("sample_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("benchmark_cohorts_key").on(t.cohortDimension, t.cohortValue, t.metric, t.capturedOn)],
);
export type BenchmarkCohort = typeof benchmarkCohorts.$inferSelect;
export type NewBenchmarkCohort = typeof benchmarkCohorts.$inferInsert;

// ---------------------------------------------------------------------------
// Agency / portfolio mode (drizzle/0048). Claim/link consent handshake: an agency
// requests to manage an existing workspace; the TARGET owner approves. Scoped by
// target_tenant_id so the approver reads/decides via ordinary RLS; the agency's
// outgoing list is read via withSystem. Provision-new + approval writes go through
// withSystem (they touch a foreign tenant), like the rest of the provisioning code.
// ---------------------------------------------------------------------------
export const agencyLinkRequests = pgTable(
  "agency_link_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyTenantId: uuid("agency_tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    targetTenantId: uuid("target_tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("agency_link_requests_target_idx").on(t.targetTenantId),
    index("agency_link_requests_agency_idx").on(t.agencyTenantId),
  ],
);
export type AgencyLinkRequest = typeof agencyLinkRequests.$inferSelect;
export type NewAgencyLinkRequest = typeof agencyLinkRequests.$inferInsert;
