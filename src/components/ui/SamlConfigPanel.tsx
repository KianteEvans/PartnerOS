import type { ReactNode } from "react";
import { MutationForm } from "@/components/ui/MutationForm";
import { saveSamlConfig } from "@/domain/sso/actions";

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
 * SAML SSO config: shows the service-provider URLs to register with the IdP, plus
 * a form to paste the IdP's issuer / SSO URL / signing cert and toggle SAML on.
 * The cert is public, so this goes through the normal gated MutationForm.
 */
export function SamlConfigPanel({
  config,
  urls,
}: {
  config: {
    enabled: boolean;
    idpEntityId: string | null;
    idpSsoUrl: string | null;
    idpCert: string | null;
  };
  urls: { login: string; acs: string; metadata: string };
}): ReactNode {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
        Let members sign in through your corporate IdP via SAML 2.0. Register these
        service-provider details with the IdP, then paste its issuer + SSO URL +
        signing certificate below. (Members are still provisioned via SCIM or invite.)
      </p>

      <div style={{ display: "grid", gap: 8 }}>
        {([
          ["Sign-in URL (SP-initiated)", urls.login],
          ["ACS / reply URL", urls.acs],
          ["SP entityID / metadata", urls.metadata],
        ] as const).map(([k, v]) => (
          <label key={k} style={labelStyle}>
            <span style={muted}>{k}</span>
            <input
              readOnly
              value={v}
              style={{ ...control, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
            />
          </label>
        ))}
      </div>

      <MutationForm
        action={saveSamlConfig}
        submitLabel="Save SAML settings"
        successMessage="SAML settings saved."
        variant="secondary"
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" name="samlEnabled" defaultChecked={config.enabled} />
          Enable SAML sign-in
        </label>
        <label style={labelStyle}>
          <span style={muted}>IdP entityID (issuer)</span>
          <input name="idpEntityId" defaultValue={config.idpEntityId ?? ""} maxLength={500} style={control} />
        </label>
        <label style={labelStyle}>
          <span style={muted}>IdP SSO URL</span>
          <input
            name="idpSsoUrl"
            type="url"
            defaultValue={config.idpSsoUrl ?? ""}
            placeholder="https://idp.example.com/app/sso/saml"
            maxLength={500}
            style={control}
          />
        </label>
        <label style={labelStyle}>
          <span style={muted}>IdP X.509 signing certificate (PEM)</span>
          <textarea
            name="idpCert"
            defaultValue={config.idpCert ?? ""}
            rows={5}
            placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----"
            style={{ ...control, fontFamily: "ui-monospace, monospace", fontSize: 11, resize: "vertical" }}
          />
        </label>
      </MutationForm>
    </div>
  );
}
