import type { CSSProperties, ReactNode } from "react";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { createPrivateOffer } from "@/domain/marketplace/offer-actions";

/**
 * Standalone "New private offer" drawer for the Marketplace Offers tracker. Unlike the
 * Deal Desk drawer, the co-sell deal + listing are picked here (both optional). The
 * offer reconciles to the AWS agreement on the next billing sync.
 */

const control: CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "inherit",
};
const label: CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
const span: CSSProperties = { fontWeight: 600, color: "var(--muted)" };
const row: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" };

export function NewOfferDrawer({
  opps,
  listings,
  defaultOppId = "",
}: {
  opps: readonly { id: string; name: string; accountName: string }[];
  listings: readonly { id: string; title: string }[];
  /** Deep-link preselect (Deal Desk arrives with ?opp=<id>). */
  defaultOppId?: string;
}): ReactNode {
  return (
    <FormDrawer
      triggerLabel="New private offer"
      triggerVariant="primary"
      title="Draft a private offer"
      action={createPrivateOffer}
      submitLabel="Save draft"
      successMessage="Private offer drafted."
    >
      <label style={label}>
        <span style={span}>Title</span>
        <input name="title" required maxLength={200} placeholder="Customer — private offer" style={control} />
      </label>
      <div style={row}>
        <label style={{ ...label, flex: 1, minWidth: 160 }}>
          <span style={span}>Co-sell deal (optional)</span>
          <select name="opportunityId" defaultValue={defaultOppId} style={control}>
            <option value="">— none —</option>
            {opps.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.accountName}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...label, flex: 1, minWidth: 160 }}>
          <span style={span}>Listing (optional)</span>
          <select name="listingId" defaultValue="" style={control}>
            <option value="">— none —</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={row}>
        <label style={{ ...label, flex: 1, minWidth: 140 }}>
          <span style={span}>Customer name</span>
          <input name="customerName" maxLength={200} style={control} />
        </label>
        <label style={{ ...label, flex: 1, minWidth: 140 }}>
          <span style={span}>Customer AWS account (optional)</span>
          <input name="customerIdentifier" maxLength={200} placeholder="AWS account id / identifier" style={control} />
        </label>
      </div>
      <div style={row}>
        <label style={{ ...label, flex: 1, minWidth: 140 }}>
          <span style={span}>Offer value (USD)</span>
          <input name="offerValue" type="number" min={0} defaultValue={0} style={control} />
        </label>
        <label style={{ ...label, flex: 1, minWidth: 140 }}>
          <span style={span}>Discount %</span>
          <input name="discountPct" type="number" min={0} max={100} defaultValue={0} style={control} />
        </label>
      </div>
      <label style={label}>
        <span style={span}>Expiration (optional)</span>
        <input name="expirationDate" type="date" style={control} />
      </label>
      <label style={label}>
        <span style={span}>Notes (optional)</span>
        <textarea name="notes" maxLength={2000} rows={3} style={{ ...control, resize: "vertical" }} />
      </label>
    </FormDrawer>
  );
}
