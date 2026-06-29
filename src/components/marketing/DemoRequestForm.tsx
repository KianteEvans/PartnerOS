"use client";

import { useActionState, type CSSProperties, type ReactNode } from "react";
import { IDLE_STATE } from "@/domain/forms";
import { submitDemoRequest } from "@/domain/demo/actions";

/**
 * Public "Book a demo" form. A client island (controlled submit state) that posts
 * to the `submitDemoRequest` server action via useActionState. On success it
 * swaps to a confirmation panel; on a validation error it shows the message
 * inline. Styled entirely with the app's design tokens so it matches the product.
 */

const TEAM_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;

const label: CSSProperties = {
  display: "block",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text)",
  marginBottom: 6,
};

const control: CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "9px 11px",
  color: "var(--text)",
  fontSize: "var(--text-base)",
  fontFamily: "inherit",
};

export function DemoRequestForm(): ReactNode {
  const [state, formAction, pending] = useActionState(submitDemoRequest, IDLE_STATE);

  if (state.ok) {
    return (
      <div
        style={{
          background: "var(--surface-tint-ok, var(--panel))",
          border: "1px solid color-mix(in srgb, var(--ok) 30%, var(--border))",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-7)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            background: "color-mix(in srgb, var(--ok) 16%, transparent)",
            color: "var(--ok)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto var(--space-3)",
          }}
          aria-hidden="true"
        >
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <strong style={{ fontSize: "var(--text-lg)", display: "block", marginBottom: 6 }}>
          Thanks — your demo request is in.
        </strong>
        <p style={{ color: "var(--muted)", fontSize: "var(--text-sm)", margin: 0 }}>
          Our team will reach out by email to schedule a time that works for you.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow)",
        padding: "var(--space-5)",
        display: "grid",
        gap: "var(--space-4)",
      }}
    >
      {/* Honeypot — hidden from people, tempting to bots. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          Company website
          <input type="text" name="companyUrl" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-4)" }}>
        <div>
          <label style={label} htmlFor="demo-name">Name</label>
          <input id="demo-name" name="name" type="text" required maxLength={120} autoComplete="name" style={control} placeholder="Jordan Lee" />
        </div>
        <div>
          <label style={label} htmlFor="demo-email">Work email</label>
          <input id="demo-email" name="email" type="email" required maxLength={200} autoComplete="email" style={control} placeholder="jordan@company.com" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-4)" }}>
        <div>
          <label style={label} htmlFor="demo-company">Company</label>
          <input id="demo-company" name="company" type="text" required maxLength={160} autoComplete="organization" style={control} placeholder="Acme Partners" />
        </div>
        <div>
          <label style={label} htmlFor="demo-team">Team size</label>
          <select id="demo-team" name="teamSize" defaultValue="" style={control}>
            <option value="">Select…</option>
            {TEAM_SIZES.map((s) => (
              <option key={s} value={s}>{s} people</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label style={label} htmlFor="demo-message">What would you like to see? (optional)</label>
        <textarea id="demo-message" name="message" maxLength={2000} rows={3} style={{ ...control, resize: "vertical" }} placeholder="We're pursuing two competencies and want help tracking evidence and co-sell." />
      </div>

      {state.error ? (
        <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--text-sm)" }}>
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        style={{
          background: "var(--accent)",
          color: "var(--accent-ink)",
          border: "1px solid var(--accent)",
          borderRadius: 8,
          padding: "10px 16px",
          fontWeight: 600,
          fontSize: "var(--text-base)",
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.65 : 1,
          justifySelf: "start",
        }}
      >
        {pending ? "Sending…" : "Request demo"}
      </button>

      <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--muted)" }}>
        We&apos;ll only use your details to schedule and follow up on your demo.
      </p>
    </form>
  );
}
