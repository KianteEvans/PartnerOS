import type { CSSProperties, ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { DemoRequestForm } from "@/components/marketing/DemoRequestForm";
import {
  IconAssessments,
  IconEvidence,
  IconAce,
  IconRoadmaps,
  IconPrograms,
  IconSolutions,
  IconMdf,
  IconApplications,
  IconCommand,
  type IconProps,
} from "@/components/ui/icons";

/**
 * Shared building blocks for the multi-page marketing site. Every page (Home,
 * Features, Pricing, Demo) composes these section components, so the look and copy
 * stay in one place. Pure server components, no DB access — all static, illustrative
 * copy grounded in the real feature set, styled with the app's design tokens and
 * primitives so the marketing site reads as native product UI.
 */

export const LOGIN = "/api/auth/login";
export const DEMO = "/demo";
const MAXW = 1080;

export const h1Style: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "clamp(30px, 5vw, 46px)",
  lineHeight: 1.08,
  letterSpacing: "-0.02em",
  margin: 0,
  color: "var(--text)",
};

export const h2Style: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-2xl)",
  lineHeight: 1.15,
  letterSpacing: "-0.02em",
  margin: 0,
  color: "var(--text)",
};

export function Section({
  id,
  background,
  children,
}: {
  id?: string | undefined;
  background?: string | undefined;
  children: ReactNode;
}): ReactNode {
  return (
    <section
      id={id}
      style={{
        width: "100%",
        background: background ?? "transparent",
        padding: "var(--space-8) var(--space-6)",
        scrollMarginTop: 64,
      }}
    >
      <div style={{ maxWidth: MAXW, margin: "0 auto" }}>{children}</div>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }): ReactNode {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--accent)",
        marginBottom: "var(--space-3)",
      }}
    >
      {children}
    </div>
  );
}

function IconTile({ children }: { children: ReactNode }): ReactNode {
  return (
    <span
      style={{
        width: 40,
        height: 40,
        borderRadius: 11,
        background: "color-mix(in srgb, var(--accent) 12%, transparent)",
        color: "var(--accent)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

function Check({ tone = "var(--ok)" }: { tone?: string }): ReactNode {
  return (
    <span style={{ color: tone, flexShrink: 0, display: "inline-flex" }} aria-hidden="true">
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}

function Cross({ tone = "var(--muted)" }: { tone?: string }): ReactNode {
  return (
    <span style={{ color: tone, flexShrink: 0, display: "inline-flex" }} aria-hidden="true">
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </span>
  );
}

const FEATURES: ReadonlyArray<{ Icon: (p: IconProps) => ReactNode; title: string; body: string }> = [
  { Icon: IconCommand, title: "Command Center", body: "An executive hub that rolls up partnership health, open decisions, overdue work, and pipeline into a single daily view." },
  { Icon: IconAce, title: "ACE Pipeline & Rep Intelligence", body: "Track AWS co-sell opportunities end to end — with AWS team routing, relationship health scoring, and at-risk prioritization." },
  { Icon: IconAssessments, title: "Readiness Assessments", body: "Score GTM and AWS competency readiness with guided modules, recommendations, and snapshot comparisons over time." },
  { Icon: IconEvidence, title: "Evidence Locker", body: "Centralize compliance and certification evidence with renewal tracking, expiration alerts, and program-fit coverage." },
  { Icon: IconPrograms, title: "Competency Programs & Tiers", body: "Plan competency and partner-tier progression against real requirement gates, with ROI attribution and best-fit recommendations." },
  { Icon: IconRoadmaps, title: "Strategic Roadmaps", body: "Compose roadmaps from the AWS program catalog, assign milestone owners, and watch live progress roll back in." },
  { Icon: IconMdf, title: "MDF Management", body: "Run marketing-development-fund requests through approval, budget, and reimbursement with deadline-risk surfacing." },
  { Icon: IconApplications, title: "Competency Applications", body: "Turn an AWS self-assessment workbook into drafted, evidence-grounded responses — then export a filled submission." },
  { Icon: IconSolutions, title: "Solutions Catalog", body: "Inventory AWS solutions with FTR status and renewal readiness, attached straight to the opportunities they drive." },
];

const STEPS: ReadonlyArray<{ n: string; title: string; body: string }> = [
  { n: "1", title: "Assess", body: "Run readiness and competency assessments to see exactly where the partnership stands against AWS requirements." },
  { n: "2", title: "Plan", body: "Compose roadmaps and adopt programs, then route the work to owners with clear gates and milestones." },
  { n: "3", title: "Execute & prove", body: "Close opportunities, collect evidence, and submit competency applications — with a Command Center keeping it honest." },
];

const SECURITY: ReadonlyArray<string> = [
  "Row-level multi-tenancy",
  "SAML 2.0 SSO",
  "OIDC login",
  "SCIM 2.0 provisioning",
  "Audit log",
  "Tenant data export (DSAR)",
  "Role-based permissions",
  "Session revocation",
];

/** A centered eyebrow + heading used above section grids. */
function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }): ReactNode {
  return (
    <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto var(--space-7)" }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 style={h2Style}>{title}</h2>
    </div>
  );
}

/** A page-top hero band for the sub-pages (Features, Pricing). */
export function PageHero({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}): ReactNode {
  return (
    <Section background="var(--surface-hero)">
      <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto" }}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 style={h1Style}>{title}</h1>
        <p style={{ fontSize: "var(--text-lg)", color: "var(--muted)", lineHeight: 1.55, margin: "var(--space-4) auto 0", maxWidth: 600 }}>
          {subtitle}
        </p>
      </div>
    </Section>
  );
}

export function HeroSection(): ReactNode {
  return (
    <Section background="var(--surface-hero)">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-8)", alignItems: "center" }}>
        <div>
          <Eyebrow>The AWS partnership operating system</Eyebrow>
          <h1 style={h1Style}>Run your entire AWS partnership from one workspace.</h1>
          <p style={{ fontSize: "var(--text-lg)", color: "var(--muted)", lineHeight: 1.55, margin: "var(--space-4) 0 var(--space-6)", maxWidth: 540 }}>
            PartnerOS unifies readiness, co-sell pipeline, evidence, competencies, tiers,
            MDF, and reporting — so AWS Partners can prove capability, plan progression,
            and grow revenue without living in spreadsheets.
          </p>
          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <ButtonLink href={DEMO}>Book a demo</ButtonLink>
            <ButtonLink href={LOGIN} variant="secondary" external>Sign in</ButtonLink>
          </div>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: "var(--space-4)" }}>
            Single sign-on with your existing identity provider — OIDC &amp; SAML 2.0.
          </p>
        </div>

        {/* Faux product snapshot, built from real primitives */}
        <Card style={{ padding: "var(--space-5)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-4)" }}>
            <strong style={{ fontSize: "var(--text-base)" }}>Partnership health</strong>
            <Badge tone="ok">Strong</Badge>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "var(--space-3)" }}>
            <MetricCard label="Health score" value="86" trend={{ values: [71, 74, 73, 78, 81, 84, 86], delta: 6 }} />
            <MetricCard label="Open work" value="12" sub="tasks in flight" trend={{ values: [18, 17, 15, 16, 14, 13, 12], delta: -8, invert: true }} />
            <MetricCard label="Co-sell pipeline" value="$2.4M" trend={{ values: [1.2, 1.5, 1.6, 1.9, 2.1, 2.3, 2.4], delta: 14, deltaSuffix: "%" }} />
            <MetricCard label="Tier progress" value="78%" sub="to Advanced" trend={{ values: [52, 58, 61, 66, 70, 74, 78], delta: 9, deltaSuffix: "%" }} />
          </div>
        </Card>
      </div>
    </Section>
  );
}

export function TrustStrip(): ReactNode {
  return (
    <Section background="var(--panel)">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-4)", justifyContent: "space-between" }}>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-md)", maxWidth: 520 }}>
          Purpose-built for AWS Partner Network teams managing readiness, co-sell, and
          competency growth across the whole organization.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          {["ACE co-sell", "Competencies", "Partner tiers", "MDF", "WAFR", "Evidence"].map((t) => (
            <Badge key={t} tone="neutral">{t}</Badge>
          ))}
        </div>
      </div>
    </Section>
  );
}

const WHY_WITHOUT: ReadonlyArray<string> = [
  "Evidence scattered across drives, inboxes, and spreadsheets",
  "Co-sell pipeline tracked by hand — and drifting out of date",
  "Competency and tier-renewal deadlines discovered too late",
  "No single view of partnership health or what needs attention",
  "Program ROI and MDF claims pieced together at reporting time",
];

const WHY_WITH: ReadonlyArray<string> = [
  "One evidence locker with renewal tracking and expiry alerts",
  "An ACE pipeline with AWS team routing and rep intelligence",
  "Competency applications drafted straight from your evidence",
  "A Command Center that surfaces decisions, risks, and renewals",
  "Program ROI, tiers, and MDF connected to the work that drives them",
];

const WHY_PILLARS: ReadonlyArray<{ title: string; body: string }> = [
  { title: "Purpose-built for AWS", body: "Models the things a generic CRM can't — ACE co-sell, competencies, partner tiers, MDF, WAFR, and the Partner Central connector." },
  { title: "Everything connected", body: "Evidence feeds competency applications, opportunities roll into program ROI, roadmaps adopt real AWS programs — one source of truth." },
  { title: "Enterprise-ready", body: "Row-level multi-tenancy, SAML/OIDC SSO, SCIM provisioning, audit logging, and data export (DSAR) from day one." },
];

export function WhyPartnerOSSection(): ReactNode {
  return (
    <Section id="why" background="var(--surface-hero)">
      <div style={{ textAlign: "center", maxWidth: 680, margin: "0 auto var(--space-7)" }}>
        <Eyebrow>Why PartnerOS?</Eyebrow>
        <h2 style={h2Style}>Built for the way AWS partnerships actually work.</h2>
        <p style={{ fontSize: "var(--text-lg)", color: "var(--muted)", lineHeight: 1.55, margin: "var(--space-4) auto 0", maxWidth: 600 }}>
          Spreadsheets and disconnected tools can&apos;t keep up with readiness, co-sell, and
          competency growth. PartnerOS brings the whole partnership into one workspace.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "var(--space-4)", alignItems: "stretch" }}>
        <Card style={{ display: "grid", gap: "var(--space-3)", alignContent: "start" }}>
          <strong style={{ fontSize: "var(--text-md)", color: "var(--muted)" }}>Without PartnerOS</strong>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "var(--space-2)" }}>
            {WHY_WITHOUT.map((t) => (
              <li key={t} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", color: "var(--muted)", fontSize: "var(--text-sm)", lineHeight: 1.45 }}>
                <Cross />
                {t}
              </li>
            ))}
          </ul>
        </Card>
        <Card style={{ display: "grid", gap: "var(--space-3)", alignContent: "start", border: "1.5px solid var(--accent)", boxShadow: "var(--shadow-md)" }}>
          <strong style={{ fontSize: "var(--text-md)", color: "var(--text)" }}>With PartnerOS</strong>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "var(--space-2)" }}>
            {WHY_WITH.map((t) => (
              <li key={t} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", color: "var(--text)", fontSize: "var(--text-sm)", lineHeight: 1.45 }}>
                <Check />
                {t}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--space-4)", marginTop: "var(--space-5)" }}>
        {WHY_PILLARS.map((p) => (
          <div key={p.title} style={{ display: "grid", gap: "var(--space-2)", alignContent: "start" }}>
            <strong style={{ fontSize: "var(--text-md)", color: "var(--text)" }}>{p.title}</strong>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-sm)", lineHeight: 1.55 }}>{p.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function FeaturesSection({
  id = "features",
  background,
  eyebrow = "One workspace, every workflow",
  title = "Everything an AWS partnership runs on.",
}: {
  id?: string;
  background?: string;
  eyebrow?: string;
  title?: string;
}): ReactNode {
  return (
    <Section id={id} background={background}>
      <SectionHead eyebrow={eyebrow} title={title} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--space-4)" }}>
        {FEATURES.map((f) => (
          <Card key={f.title} interactive style={{ display: "grid", gap: "var(--space-3)", alignContent: "start" }}>
            <IconTile><f.Icon size={20} /></IconTile>
            <strong style={{ fontSize: "var(--text-md)", color: "var(--text)" }}>{f.title}</strong>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-sm)", lineHeight: 1.55 }}>{f.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

export function HowItWorksSection({ background = "var(--panel)" }: { background?: string } = {}): ReactNode {
  return (
    <Section id="how-it-works" background={background}>
      <SectionHead eyebrow="How it works" title="Assess, plan, and prove — in one loop." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "var(--space-4)" }}>
        {STEPS.map((s) => (
          <div key={s.n} style={{ display: "grid", gap: "var(--space-3)" }}>
            <span style={{ width: 36, height: 36, borderRadius: 999, background: "var(--accent)", color: "var(--accent-ink)", fontWeight: 700, fontSize: "var(--text-md)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              {s.n}
            </span>
            <strong style={{ fontSize: "var(--text-md)" }}>{s.title}</strong>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-sm)", lineHeight: 1.55 }}>{s.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function OutcomesSection(): ReactNode {
  return (
    <Section id="outcomes">
      <SectionHead eyebrow="Why it matters" title="Replace the spreadsheet sprawl." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-4)" }}>
        <MetricCard label="Partnership domains in one place" value="9+" />
        <MetricCard label="One source of truth for AWS readiness" value="1" />
        <MetricCard label="Co-sell, evidence & MDF — connected" value="3-in-1" />
        <MetricCard label="Enterprise SSO out of the box" value="SAML" />
      </div>
      <p style={{ textAlign: "center", color: "var(--muted)", fontSize: "var(--text-xs)", marginTop: "var(--space-5)" }}>
        Figures illustrate product scope, not a specific customer result.
      </p>
    </Section>
  );
}

export function SecuritySection({ background = "var(--panel)" }: { background?: string } = {}): ReactNode {
  return (
    <Section id="security" background={background}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "var(--space-7)", alignItems: "center" }}>
        <div>
          <Eyebrow>Enterprise-ready</Eyebrow>
          <h2 style={h2Style}>Built for security and scale from day one.</h2>
          <p style={{ color: "var(--muted)", fontSize: "var(--text-md)", lineHeight: 1.55, marginTop: "var(--space-4)" }}>
            Every workspace is isolated with database row-level security and role-based
            permissions. Bring your own identity provider, provision users automatically,
            and keep a complete audit trail.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          {SECURITY.map((s) => (
            <Badge key={s} tone="info">{s}</Badge>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function FinalCtaSection(): ReactNode {
  return (
    <Section background="var(--surface-hero)">
      <div style={{ textAlign: "center", maxWidth: 620, margin: "0 auto" }}>
        <h2 style={{ ...h2Style, fontSize: "clamp(26px, 4vw, 36px)" }}>
          Bring your AWS partnership into one operating system.
        </h2>
        <p style={{ color: "var(--muted)", fontSize: "var(--text-lg)", margin: "var(--space-4) 0 var(--space-6)" }}>
          See it on your own competencies, pipeline, and evidence — book a walkthrough with our team.
        </p>
        <ButtonLink href={DEMO}>Book a demo</ButtonLink>
      </div>
    </Section>
  );
}

export function DemoSection(): ReactNode {
  return (
    <Section id="book-a-demo" background="var(--surface-hero)">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-8)", alignItems: "start" }}>
        <div>
          <Eyebrow>Book a demo</Eyebrow>
          <h2 style={{ ...h2Style, fontSize: "clamp(26px, 4vw, 36px)" }}>See PartnerOS on your partnership.</h2>
          <p style={{ color: "var(--muted)", fontSize: "var(--text-lg)", margin: "var(--space-4) 0 var(--space-5)" }}>
            Tell us a little about your team and we&apos;ll walk you through readiness, co-sell,
            evidence, and competency tracking on a live workspace.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "var(--space-2)" }}>
            {["A 30-minute guided walkthrough", "Tailored to the competencies you're pursuing", "No commitment — just a look at the product"].map((t) => (
              <li key={t} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "var(--text)", fontSize: "var(--text-sm)" }}>
                <Check />
                {t}
              </li>
            ))}
          </ul>
          <p style={{ marginTop: "var(--space-5)", fontSize: "var(--text-sm)", color: "var(--muted)" }}>
            Already a customer?{" "}
            <a href={LOGIN} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>Sign in</a>
          </p>
        </div>
        <DemoRequestForm />
      </div>
    </Section>
  );
}

const TIERS: ReadonlyArray<{
  name: string;
  tagline: string;
  popular?: boolean;
  features: ReadonlyArray<string>;
  inherits?: string;
}> = [
  {
    name: "Team",
    tagline: "The readiness foundation for partners getting started.",
    features: [
      "Readiness Assessments",
      "Evidence Locker",
      "Competency Programs & Tiers",
      "Strategic Roadmaps",
      "Command Center",
    ],
  },
  {
    name: "Growth",
    tagline: "Add co-sell and funding as the partnership scales.",
    popular: true,
    inherits: "Everything in Team, plus",
    features: [
      "ACE Pipeline & Rep Intelligence",
      "MDF Management",
      "Competency Applications",
      "Solutions Catalog",
      "Reporting & metric history",
    ],
  },
  {
    name: "Enterprise",
    tagline: "Security, governance, and scale for the whole org.",
    inherits: "Everything in Growth, plus",
    features: [
      "SAML 2.0 SSO & SCIM provisioning",
      "Audit log & session revocation",
      "Tenant data export (DSAR)",
      "Role-based permissions",
      "Priority onboarding & support",
    ],
  },
];

export function PricingSection(): ReactNode {
  return (
    <Section id="pricing">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--space-5)", alignItems: "stretch" }}>
        {TIERS.map((t) => (
          <Card
            key={t.name}
            style={{
              display: "grid",
              gap: "var(--space-4)",
              alignContent: "start",
              padding: "var(--space-6)",
              border: t.popular ? "1.5px solid var(--accent)" : "1px solid var(--border)",
              boxShadow: t.popular ? "var(--shadow-md)" : "var(--shadow-sm)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <strong style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-display)" }}>{t.name}</strong>
              {t.popular ? <Badge tone="accent">Most popular</Badge> : null}
            </div>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-sm)", lineHeight: 1.5, minHeight: 40 }}>{t.tagline}</p>
            <div>
              <div style={{ fontSize: "var(--text-2xl)", fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--text)" }}>Custom</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 2 }}>Tailored to your team — book a demo for a quote.</div>
            </div>
            <ButtonLink href={DEMO} fullWidth variant={t.popular ? "primary" : "secondary"}>Book a demo</ButtonLink>
            {t.inherits ? (
              <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t.inherits}</div>
            ) : (
              <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Includes</div>
            )}
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "var(--space-2)" }}>
              {t.features.map((f) => (
                <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", color: "var(--text)", fontSize: "var(--text-sm)", lineHeight: 1.45 }}>
                  <Check />
                  {f}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <p style={{ textAlign: "center", color: "var(--muted)", fontSize: "var(--text-xs)", marginTop: "var(--space-6)" }}>
        Every plan includes enterprise-grade tenant isolation and SSO. Pricing scales with
        your team and the competencies you&apos;re pursuing — book a demo for a tailored quote.
      </p>
    </Section>
  );
}

const FAQS: ReadonlyArray<{ q: string; a: string }> = [
  { q: "How is PartnerOS priced?", a: "Pricing is tailored to your team size and the capabilities you need. Book a demo and we'll put together a quote that fits." },
  { q: "Can we start with one area and expand?", a: "Yes. Many teams start with readiness and evidence, then add co-sell pipeline, MDF, and competency applications as the partnership grows." },
  { q: "Do you support enterprise SSO?", a: "Every plan includes tenant isolation and SSO. Enterprise adds SAML 2.0, SCIM provisioning, audit logging, and data export (DSAR)." },
  { q: "How do we get started?", a: "Book a demo for a guided walkthrough on your own competencies and pipeline. There's no commitment to take a look." },
];

export function FaqSection(): ReactNode {
  return (
    <Section background="var(--panel)">
      <SectionHead eyebrow="Questions" title="Pricing, answered." />
      <div style={{ display: "grid", gap: "var(--space-3)", maxWidth: 760, margin: "0 auto" }}>
        {FAQS.map((f) => (
          <Card key={f.q} style={{ display: "grid", gap: "var(--space-2)" }}>
            <strong style={{ fontSize: "var(--text-md)", color: "var(--text)" }}>{f.q}</strong>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-sm)", lineHeight: 1.55 }}>{f.a}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
