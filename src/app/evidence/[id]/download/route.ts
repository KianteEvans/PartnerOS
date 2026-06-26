import { and, eq } from "drizzle-orm";
import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { evidence, storageObjects } from "@/db/schema";
import { assertObjectIsClean } from "@/storage/malware-scan";
import { getObjectStorage } from "@/storage/s3";
import { AppError } from "@/http/errors";

/**
 * Evidence file download. Fail-closed: the bytes are streamed only after
 * assertObjectIsClean confirms the linked object belongs to this tenant (RLS)
 * AND was scanned clean. A pending/infected/error scan returns 403.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const identity = await getServerIdentity();
    requirePermission(identity, "evidence:read");

    const [row] = await withTenant(identity, (tx) =>
      tx
        .select({
          objectId: evidence.storageObjectId,
          fileName: evidence.fileName,
          objectKey: storageObjects.objectKey,
          contentType: storageObjects.contentType,
        })
        .from(evidence)
        .leftJoin(storageObjects, eq(storageObjects.id, evidence.storageObjectId))
        .where(and(eq(evidence.id, id), eq(evidence.tenantId, identity.tenantId))),
    );
    if (!row || !row.objectId || !row.objectKey) {
      return new Response("Not found", { status: 404 });
    }

    // Throws ForbiddenError unless the scan is clean.
    await assertObjectIsClean(identity, row.objectId);

    const bytes = await getObjectStorage().get(row.objectKey);
    const contentType = row.contentType ?? "application/octet-stream";
    // Copy into a plain ArrayBuffer (a valid BodyInit) to sidestep typed-array
    // generic friction with Response/Blob types.
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${(row.fileName ?? "evidence").replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    const message = err instanceof AppError && err.expose ? err.message : "Error";
    return new Response(message, { status });
  }
}
