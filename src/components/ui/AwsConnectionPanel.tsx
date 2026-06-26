import type { ReactNode } from "react";
import { MutationForm } from "@/components/ui/MutationForm";
import { saveAwsConnection } from "@/domain/aws/actions";

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
 * AWS Partner Central connector config. The tenant creates a cross-account IAM
 * role that trusts PartnerOS with the external ID; the app assumes it (read-only)
 * to sync co-sell opportunities. No long-lived AWS keys are stored. Gated
 * MutationForm (the role ARN + external ID are not high-value on their own).
 */
export function AwsConnectionPanel({
  config,
}: {
  config: {
    roleArn: string;
    externalId: string;
    region: string;
    catalog: string;
    enabled: boolean;
    enrichTeam: boolean;
    status: string;
    lastError: string | null;
  };
}): ReactNode {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
        Read co-sell opportunities from AWS Partner Central. Create an IAM role that
        trusts PartnerOS with the external ID below; the app assumes it read-only —
        no AWS access keys are stored. Use the <strong>Sandbox</strong> catalog to test.
      </p>

      <MutationForm
        action={saveAwsConnection}
        submitLabel="Save AWS connection"
        successMessage="AWS connection saved."
        variant="secondary"
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" name="enabled" defaultChecked={config.enabled} />
          Enable AWS Partner Central
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
          <span style={muted}>AWS region</span>
          <input name="region" defaultValue={config.region || "us-east-1"} maxLength={32} style={control} />
        </label>
        <label style={labelStyle}>
          <span style={muted}>Catalog</span>
          <select name="catalog" defaultValue={config.catalog || "Sandbox"} style={control}>
            <option value="Sandbox">Sandbox (testing)</option>
            <option value="AWS">AWS (production)</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 13 }}>
          <input type="checkbox" name="enrichTeam" defaultChecked={config.enrichTeam} style={{ marginTop: 3 }} />
          <span>
            Enrich the AWS sales team per opportunity
            <span style={{ display: "block", color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
              Pulls each deal&apos;s AWS Sales Rep / Account Owner / PSM / PDM via
              GetAwsOpportunitySummary (one call per opportunity). Add{" "}
              <code>partnercentral:GetAwsOpportunitySummary</code> to the role&apos;s policy.
              Powers the AWS reps dashboard in ACE.
            </span>
          </span>
        </label>
      </MutationForm>

      {config.status === "error" && config.lastError && (
        <p style={{ margin: 0, color: "var(--danger)", fontSize: 12 }}>
          Last sync error: {config.lastError}
        </p>
      )}
    </div>
  );
}
