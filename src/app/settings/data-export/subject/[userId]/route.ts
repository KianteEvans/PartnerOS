import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { AppError } from "@/http/errors";
import { loadSubjectExport } from "@/domain/dsar/subject-load";

/**
 * Per-individual DSAR export (GDPR/CCPA subject access request). Returns
 * everything the workspace holds about ONE member as a JSON bundle. Read-only and
 * tenant-scoped via RLS (loadSubjectExport runs under withTenant), so you can only
 * export a member of your OWN workspace — a subject in another tenant is invisible
 * and returns 404. Gated on settings:manage (owner/admin), like the whole-
 * workspace export; the Settings surface fences it behind the governance package.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const identity = await getServerIdentity();
    requirePermission(identity, "settings:manage");
    const { userId } = await params;
    // Malformed id -> not-found (avoids a Postgres uuid-cast error surfacing as 500).
    if (!UUID_RE.test(userId)) return new Response("Not found", { status: 404 });

    const bundle = await loadSubjectExport(identity, userId);
    if (!bundle) return new Response("Not found", { status: 404 });

    // bigint columns (e.g. storage size) aren't JSON-serializable; stringify them.
    const body = JSON.stringify(
      bundle,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    );
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="partneros-subject-${userId}-export.json"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return new Response(err instanceof AppError ? err.message : "Error", { status });
  }
}
