import type { CSSProperties, ReactNode } from "react";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { createPrivateOffer } from "@/domain/marketplace/offer-actions";

/**
 * "Draft a private offer" drawer — creates a draft co-sell private offer attributed to
 * this ACE deal (the marketplace bridge). Prefilled from the deal's customer + linked
 * listings. The offer is sent + reconciled to the real AWS agreement from the tracker.
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

export function OfferDrawer({
  oppId,
  customerName,
  listings,
  triggerLabel = "Draft private offer",
  triggerVariant = "primary",
}: {
  oppId: string;
  customerName: string;
  listings: readonly { id: string; title: string }[];
  triggerLabel?: string;
  triggerVariant?: "primary" | "secondary";
}): ReactNode {
  return (
    <FormDrawer
      triggerLabel={triggerLabel}
      triggerVariant={triggerVariant}
      title="Draft a private offer"
      action={createPrivateOffer}
      submitLabel="Save draft"
      successMessage="Private offer drafted."
      hidden={{ opportunityId: oppId }}
    >
      <label style={label}>
        <span style={span}>Title</span>
        <input name="title" required maxLength={200} defaultValue={customerName ? `${customerName} — private offer` : ""} style={control} />
      </label>
      {listings.length > 0 && (
        <label style={label}>
          <span style={span}>Listing</span>
          <select name="listingId" defaultValue={listings[0]!.id} style={control}>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div style={row}>
        <label style={{ ...label, flex: 1, minWidth: 140 }}>
          <span style={span}>Customer name</span>
          <input name="customerName" maxLength={200} defaultValue={customerName} style={control} />
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
