import { eq } from "drizzle-orm";
import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { marketplaceCharges, marketplaceAgreements } from "@/db/schema";
import { AppError } from "@/http/errors";

/**
 * AWS Marketplace billing export (CSV): charges joined to their agreement's customer/offer.
 * Read-only and tenant-scoped via RLS. Money rendered in dollars.
 */
export async function GET(): Promise<Response> {
  try {
    const identity = await getServerIdentity();
    requirePermission(identity, "marketplace:read");

    const { charges, agreements } = await withTenant(identity, async (tx) => {
      const charges = await tx.select().from(marketplaceCharges).where(eq(marketplaceCharges.tenantId, identity.tenantId));
      const agreements = await tx
        .select({ agreementId: marketplaceAgreements.agreementId, customer: marketplaceAgreements.customerIdentifier, offer: marketplaceAgreements.offerType })
        .from(marketplaceAgreements)
        .where(eq(marketplaceAgreements.tenantId, identity.tenantId));
      return { charges, agreements };
    });
    const byAgreement = new Map(agreements.map((a) => [a.agreementId, a]));

    const header = ["billing_period", "agreement_id", "customer", "offer", "dimension", "quantity", "amount_usd"];
    const lines = [header.join(",")];
    for (const c of charges) {
      const a = byAgreement.get(c.agreementId);
      lines.push(
        [
          (c.billingPeriodStart ?? "").slice(0, 7),
          c.agreementId,
          a?.customer ?? "",
          a?.offer ?? "",
          c.dimension,
          c.quantity,
          (c.amount / 100).toFixed(2),
        ].map(csvCell).join(","),
      );
    }

    return new Response(lines.join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="marketplace-billing.csv"',
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return new Response(err instanceof AppError ? err.message : "Error", { status });
  }
}

function csvCell(value: unknown): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
