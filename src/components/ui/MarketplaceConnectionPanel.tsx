import type { ReactNode } from "react";
import { MutationForm } from "@/components/ui/MutationForm";
import { saveMarketplaceConnection } from "@/domain/marketplace/actions";

const labelStyle = { display: "grid", gap: 4, fontSize: 12 } as const;
const muted = { color: "var(--muted)" } as const;
const control = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 13,
} as const;

/**
 * AWS Marketplace connector config. AWS is the source of truth for listings, metering,
 * entitlements, billing, and attributed revenue; PartnerOS assumes the same cross-account
 * IAM role (read + write-through via Catalog ChangeSets) to sync them. Shares the role ARN
 * + external ID with the Partner Central connector but toggles independently. No AWS access
 * keys are stored.
 */
export function MarketplaceConnectionPanel({
  config,
}: {
  config: {
    roleArn: string;
    externalId: string;
    region: string;
    sellerId: string;
    marketplaceEnabled: boolean;
    marketplaceStatus: string;
    marketplaceLastError: string | null;
  };
}): ReactNode {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
        Manage your AWS Marketplace listings, metering, entitlements, billing, and attributed
        revenue. PartnerOS assumes a cross-account IAM role (the same one used for Partner
        Central) to read the catalog and write listing edits through as Catalog change sets.
      </p>

      <MutationForm
        action={saveMarketplaceConnection}
        submitLabel="Save Marketplace connection"
        successMessage="Marketplace connection saved."
        variant="secondary"
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" name="enabled" defaultChecked={config.marketplaceEnabled} />
          Enable AWS Marketplace
        </label>
        <label style={labelStyle}>
          <span style={muted}>IAM role ARN (PartnerOS assumes this)</span>
          <input
            name="roleArn"
            defaultValue={config.roleArn}
            placeholder="arn:aws:iam::123456789012:role/PartnerOSConnect"
            maxLength={2048}
            style={{ ...control, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
          />
        </label>
        <label style={labelStyle}>
          <span style={muted}>External ID (sts:AssumeRole condition)</span>
          <input
            name="externalId"
            type="password"
            defaultValue={config.externalId}
            placeholder="shared secret in the role trust policy"
            maxLength={1024}
            style={control}
          />
        </label>
        <label style={labelStyle}>
          <span style={muted}>Seller ID (AWS Marketplace seller account)</span>
          <input name="sellerId" defaultValue={config.sellerId} maxLength={64} style={control} />
        </label>
        <label style={labelStyle}>
          <span style={muted}>AWS region</span>
          <input name="region" defaultValue={config.region || "us-east-1"} maxLength={32} style={control} />
        </label>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 11 }}>
          The role needs read access to the Catalog, Entitlement, Agreement, and Metering
          APIs plus <code>aws-marketplace:StartChangeSet</code> and
          <code> aws-marketplace:BatchMeterUsage</code> for editing and metering.
        </p>
      </MutationForm>

      {config.marketplaceStatus === "error" && config.marketplaceLastError && (
        <p style={{ margin: 0, color: "var(--danger)", fontSize: 12 }}>
          Last sync error: {config.marketplaceLastError}
        </p>
      )}
    </div>
  );
}
