import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { evidence, storageObjects, users } from "@/db/schema";
import { can } from "@/authz/permissions";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, statusTone } from "@/components/ui/Badge";
import { RingGauge } from "@/components/ui/RingGauge";
import { Card } from "@/components/ui/Card";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { SearchForm } from "@/components/ui/SearchForm";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { BulkProvider } from "@/components/ui/bulk/BulkProvider";
import { BulkBar } from "@/components/ui/bulk/BulkBar";
import { BulkCheckbox } from "@/components/ui/bulk/BulkCheckbox";
import { BulkActionForm } from "@/components/ui/bulk/BulkActionForm";
import { Pagination } from "@/components/ui/Pagination";
import {
  createEvidence,
  updateEvidence,
  reviewEvidence,
  uploadEvidenceFile,
  bulkUpdateEvidence,
} from "@/domain/evidence/actions";
import { parseListParams, listHref, pageCount } from "@/domain/list";
import { addDays } from "@/domain/dates";
import {
  renewalStatus,
  fileReadiness,
  EVIDENCE_VIEWS,
  EVIDENCE_VIEW_LABELS,
  EXPIRING_WINDOW_DAYS,
  type EvidenceView,
} from "@/domain/evidence/inventory";

/**
 * SQL mirror of the pure `matchesView` (domain/evidence/inventory.ts), so the
 * locker is filtered/counted in the database instead of by loading every row.
 * `undefined` means "no extra predicate" (the "all" view).
 */
function evidenceViewCondition(view: EvidenceView, today: string): SQL | undefined {
  switch (view) {
    case "all":
      return undefined;
    case "missing":
      return eq(evidence.status, "missing");
    case "rejected":
      return eq(evidence.status, "rejected");
    case "expiring_soon":
      return and(
        isNotNull(evidence.expirationDate),
        gte(evidence.expirationDate, today),
        lte(evidence.expirationDate, addDays(today, EXPIRING_WINDOW_DAYS)),
      );
    case "needs_owner":
      return and(isNull(evidence.ownerUserId), ne(evidence.status, "missing"));
    case "ready_for_review":
      return and(
        inArray(evidence.status, ["collected", "in_review"]),
        isNotNull(evidence.ownerUserId),
        or(isNull(evidence.expirationDate), gte(evidence.expirationDate, today)),
      );
  }
}

const labelStyle = { display: "grid", gap: 4, fontSize: 12 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 8px",
  color: "var(--text)",
  fontSize: 13,
} as const;

const TYPE_LABELS: Record<string, string> = {
  case_study: "Case study",
  certification: "Certification",
  architecture: "Architecture",
  security: "Security",
  billing: "Billing",
  reference: "Reference",
  other: "Other",
};
const TYPES = Object.keys(TYPE_LABELS);

function isView(v: string | undefined): v is EvidenceView {
  return v !== undefined && (EVIDENCE_VIEWS as readonly string[]).includes(v);
}

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const canReview = can(identity.role, "evidence:review");

  const sp = await searchParams;
  const viewParam = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view: EvidenceView = isView(viewParam) ? viewParam : "all";
  const params = parseListParams(sp, { sortable: [], defaultSort: "created" });
  const today = new Date().toISOString().slice(0, 10);

  const { pageRows, total, counts, stats, members } = await withTenant(identity, async (tx) => {
    const tenant = eq(evidence.tenantId, identity.tenantId);

    // Pills: one bounded count per view (independent of the text search).
    const countRows = await Promise.all(
      EVIDENCE_VIEWS.map((v) =>
        tx.select({ n: count() }).from(evidence).where(and(tenant, evidenceViewCondition(v, today))),
      ),
    );
    const counts = Object.fromEntries(
      EVIDENCE_VIEWS.map((v, i) => [v, countRows[i]![0]?.n ?? 0]),
    ) as Record<EvidenceView, number>;

    // Completeness overview — aggregated in SQL over the whole locker.
    const statRows = await tx
      .select({
        total: sql<number>`count(*)::int`,
        approved: sql<number>`(count(*) filter (where ${evidence.status} = 'approved'))::int`,
        missing: sql<number>`(count(*) filter (where ${evidence.status} = 'missing'))::int`,
      })
      .from(evidence)
      .where(tenant);
    const s = statRows[0]!;
    const stats = {
      total: s.total,
      approved: s.approved,
      missing: s.missing,
      percent: s.total === 0 ? 0 : Math.round((s.approved / s.total) * 100),
    };

    // Display: active view + optional title search, newest first, paginated.
    const where = and(
      tenant,
      evidenceViewCondition(view, today),
      params.q ? ilike(evidence.title, `%${params.q}%`) : undefined,
    );
    const pageRows = await tx
      .select({
        id: evidence.id,
        title: evidence.title,
        evidenceType: evidence.evidenceType,
        status: evidence.status,
        program: evidence.program,
        ownerUserId: evidence.ownerUserId,
        qualityScore: evidence.qualityScore,
        reusable: evidence.reusable,
        dueDate: evidence.dueDate,
        expirationDate: evidence.expirationDate,
        reviewNotes: evidence.reviewNotes,
        fileName: evidence.fileName,
        storageObjectId: evidence.storageObjectId,
        createdAt: evidence.createdAt,
        scanStatus: storageObjects.scanStatus,
      })
      .from(evidence)
      .leftJoin(storageObjects, eq(storageObjects.id, evidence.storageObjectId))
      .where(where)
      .orderBy(desc(evidence.createdAt), asc(evidence.id))
      .limit(params.pageSize)
      .offset(params.offset);
    const totalRows = await tx.select({ n: count() }).from(evidence).where(where);

    const members = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.tenantId, identity.tenantId));
    return { pageRows, total: totalRows[0]?.n ?? 0, counts, stats, members };
  });

  const emailById = new Map(members.map((m) => [m.id, m.email]));
  const totalPages = pageCount(total, params.pageSize);

  return (
    <PageShell>
      <PageHeader
        title="Evidence Locker"
        actions={
          <FormDrawer
            triggerLabel="Add evidence"
            title="Add evidence"
            action={createEvidence}
            submitLabel="Add"
            successMessage="Evidence added."
          >
            <label style={labelStyle}>
              <span style={spanStyle}>Title</span>
              <input name="title" required maxLength={200} style={controlStyle} />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Type</span>
              <select name="evidenceType" defaultValue="case_study" style={controlStyle}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Program (optional)</span>
              <input name="program" maxLength={200} style={controlStyle} />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Due date</span>
              <input name="dueDate" type="date" style={controlStyle} />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Expiration</span>
              <input name="expirationDate" type="date" style={controlStyle} />
            </label>
          </FormDrawer>
        }
      />

      <Link href="/evidence/fit" style={{ textDecoration: "none" }}>
        <Card
          interactive
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            borderColor: "color-mix(in srgb, var(--accent) 40%, var(--border))",
          }}
        >
          <div style={{ display: "grid", gap: 3 }}>
            <strong style={{ fontSize: 14, color: "var(--text)" }}>
              See which AWS programs your evidence qualifies you for
            </strong>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Evaluate your evidence against the AWS catalog, see the gaps, and pursue the best-fit
              competencies.
            </span>
          </div>
          <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" }}>
            Program Fit →
          </span>
        </Card>
      </Link>

      <Panel
        title="Overview"
        actions={
          <a href="/evidence/export" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13 }}>
            Export CSV
          </a>
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <RingGauge
            value={stats.percent}
            label={`${stats.percent}%`}
            caption="complete"
            color={stats.percent >= 75 ? "var(--ok)" : stats.percent >= 40 ? "var(--warn)" : "var(--danger)"}
            size={112}
          />
          <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
            <div><strong style={{ fontSize: 20 }}>{stats.approved}</strong> <span style={{ color: "var(--muted)" }}>of {stats.total} approved</span></div>
            <div style={{ color: stats.missing > 0 ? "var(--danger)" : "var(--muted)" }}>{stats.missing} missing</div>
          </div>
        </div>
      </Panel>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {EVIDENCE_VIEWS.map((v) => {
            const active = v === view;
            return (
              <Link
                key={v}
                href={listHref("/evidence", { view: v, q: params.q })}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  textDecoration: "none",
                  border: "1px solid var(--border)",
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "var(--accent-ink)" : "var(--muted)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {EVIDENCE_VIEW_LABELS[v]} ({counts[v]})
              </Link>
            );
          })}
        </nav>
        <SearchForm q={params.q} placeholder="Search by title…" hidden={{ view }} />
      </div>

      <SavedViewsBar listKey="evidence" current={{ view, q: params.q }} />

      {pageRows.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          {params.q ? `No evidence matches “${params.q}” in this view.` : "No evidence in this view."}
        </p>
      ) : (
        <BulkProvider allIds={pageRows.map((r) => r.id)}>
          <div style={{ display: "grid", gap: 12 }}>
            {pageRows.map((item) => (
              <div key={item.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <BulkCheckbox id={item.id} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <EvidenceCard
                    item={item}
                    ownerEmail={item.ownerUserId ? emailById.get(item.ownerUserId) ?? null : null}
                    members={members}
                    today={today}
                    canReview={canReview}
                  />
                </div>
              </div>
            ))}
          </div>
          <BulkBar>
            <BulkActionForm
              action={bulkUpdateEvidence}
              field="ownerUserId"
              options={members.map((m) => ({ value: m.id, label: m.email }))}
              submitLabel="Set owner"
            />
            <BulkActionForm
              action={bulkUpdateEvidence}
              field="status"
              options={[
                { value: "missing", label: "Missing" },
                { value: "collected", label: "Collected" },
                { value: "in_review", label: "In review" },
              ]}
              submitLabel="Set status"
            />
          </BulkBar>
        </BulkProvider>
      )}

      <Pagination
        page={params.page}
        totalPages={totalPages}
        total={total}
        prevHref={listHref("/evidence", { view, q: params.q, page: params.page - 1 })}
        nextHref={listHref("/evidence", { view, q: params.q, page: params.page + 1 })}
      />
    </PageShell>
  );
}

type Row = {
  id: string;
  title: string;
  evidenceType: string;
  status: string;
  program: string | null;
  ownerUserId: string | null;
  qualityScore: number | null;
  reusable: boolean;
  dueDate: string | null;
  expirationDate: string | null;
  reviewNotes: string;
  fileName: string | null;
  storageObjectId: string | null;
  scanStatus: "pending" | "clean" | "infected" | "error" | null;
};

function EvidenceCard({
  item,
  ownerEmail,
  members,
  today,
  canReview,
}: {
  item: Row & { createdAt: Date };
  ownerEmail: string | null;
  members: ReadonlyArray<{ id: string; email: string }>;
  today: string;
  canReview: boolean;
}): ReactNode {
  const renewal = renewalStatus(
    { status: item.status as never, ownerUserId: item.ownerUserId, expirationDate: item.expirationDate, createdAt: item.createdAt },
    today,
  );
  const readiness = fileReadiness(item.scanStatus);
  const isReviewed = item.status === "approved" || item.status === "rejected";

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong style={{ fontSize: 15 }}>{item.title}</strong>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 12 }}>
          {TYPE_LABELS[item.evidenceType] ?? item.evidenceType}
          <Badge tone={statusTone(item.status)}>{item.status}</Badge>
          {item.qualityScore !== null ? `Q${item.qualityScore}` : ""}
          {renewal !== "none" ? <Badge tone={statusTone(renewal)}>{renewal}</Badge> : null}
        </span>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 10px" }}>
        {item.program ? `Program: ${item.program} · ` : ""}
        Owner: {ownerEmail ?? "Unassigned"}
        {item.expirationDate ? ` · Expires ${item.expirationDate}` : ""}
        {item.reusable ? " · reusable" : ""}
      </p>

      {/* File */}
      <p style={{ fontSize: 13, margin: "0 0 10px" }}>
        {item.storageObjectId ? (
          readiness === "ready" ? (
            <a href={`/evidence/${item.id}/download`} style={{ color: "var(--accent)" }}>
              Download {item.fileName ?? "file"}
            </a>
          ) : readiness === "scanning" ? (
            <span style={spanStyle}>Scanning {item.fileName ?? "file"}… (not yet downloadable)</span>
          ) : (
            <span style={{ color: "var(--danger)" }}>File blocked (scan {item.scanStatus})</span>
          )
        ) : (
          <span style={spanStyle}>No file attached</span>
        )}
      </p>

      {/* Per-row actions — each opens a focused drawer instead of an always-open form. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <FormDrawer
          triggerLabel="Edit"
          triggerVariant="secondary"
          title="Edit evidence"
          action={updateEvidence}
          submitLabel="Save changes"
          successMessage="Evidence updated."
          submitVariant="secondary"
          hidden={{ evidenceId: item.id }}
        >
          <label style={labelStyle}>
            <span style={spanStyle}>Owner</span>
            <select name="ownerUserId" defaultValue={item.ownerUserId ?? ""} style={controlStyle}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.email}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>Status</span>
            <select
              name="status"
              defaultValue={isReviewed ? "collected" : item.status}
              style={controlStyle}
            >
              <option value="missing">Missing</option>
              <option value="collected">Collected</option>
              <option value="in_review">In review</option>
            </select>
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>Expiration</span>
            <input name="expirationDate" type="date" defaultValue={item.expirationDate ?? ""} style={controlStyle} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" name="reusable" defaultChecked={item.reusable} />
            Reusable
          </label>
        </FormDrawer>

        <FormDrawer
          triggerLabel="Upload file"
          triggerVariant="secondary"
          title="Upload file"
          action={uploadEvidenceFile}
          submitLabel="Upload"
          successMessage="File uploaded."
          submitVariant="secondary"
          hidden={{ evidenceId: item.id }}
        >
          <label style={labelStyle}>
            <span style={spanStyle}>File</span>
            <input type="file" name="file" style={{ fontSize: 13 }} />
          </label>
        </FormDrawer>

        {canReview && (
          <FormDrawer
            triggerLabel="Review"
            triggerVariant="secondary"
            title="Review evidence"
            action={reviewEvidence}
            submitLabel="Submit review"
            successMessage="Review submitted."
            submitVariant="secondary"
            hidden={{ evidenceId: item.id }}
          >
            <label style={labelStyle}>
              <span style={spanStyle}>Decision</span>
              <select name="decision" defaultValue="approved" style={controlStyle}>
                <option value="approved">Approve</option>
                <option value="rejected">Reject</option>
              </select>
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Quality (0–100)</span>
              <input name="qualityScore" type="number" min={0} max={100} defaultValue={item.qualityScore ?? ""} style={controlStyle} />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Notes</span>
              <input name="notes" maxLength={2000} defaultValue={item.reviewNotes} style={controlStyle} />
            </label>
          </FormDrawer>
        )}
      </div>
    </Card>
  );
}
