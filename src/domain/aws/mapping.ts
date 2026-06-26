/**
 * Pure mapping from AWS Partner Central Selling "OpportunitySummary" objects to
 * our read-only mirror rows. Operates on a minimal local shape (NOT the AWS SDK
 * types) so it is unit-testable and independent of SDK version drift — the client
 * casts SDK summaries to PcOpportunitySummary before calling here.
 *
 * Field names match the SDK's OpportunitySummary: `Id` is the system opportunity
 * id, `Customer.Account.CompanyName` the end customer, `LifeCycle.Stage` the
 * co-sell stage, `Project.ExpectedCustomerSpend[].Amount` the revenue estimate.
 * (The summary has no human title, so the customer company name is the display name.)
 */

export type AceStage =
  | "prospect"
  | "qualified"
  | "tech_validation"
  | "business_validation"
  | "committed"
  | "launched"
  | "closed_lost";
export type AceStatus = "open" | "won" | "lost";

// Optional fields use `| undefined` (not `| null`) to match the AWS SDK's
// OpportunitySummary under exactOptionalPropertyTypes, so SDK objects pass directly.
export interface PcExpectedSpend {
  readonly Amount?: string | undefined;
  readonly CurrencyCode?: string | undefined;
}
export interface PcOpportunitySummary {
  readonly Id?: string | undefined;
  readonly PartnerOpportunityIdentifier?: string | undefined;
  readonly Customer?: { readonly Account?: { readonly CompanyName?: string | undefined } | undefined } | undefined;
  readonly LifeCycle?: { readonly Stage?: string | undefined; readonly ReviewStatus?: string | undefined } | undefined;
  readonly Project?: { readonly ExpectedCustomerSpend?: readonly PcExpectedSpend[] | undefined } | undefined;
}

export interface MirrorRow {
  readonly externalId: string;
  readonly name: string;
  readonly accountName: string;
  readonly stage: AceStage;
  readonly status: AceStatus;
  readonly amount: number;
  readonly awsStageRaw: string;
}

const STAGE_MAP: Readonly<Record<string, AceStage>> = {
  prospect: "prospect",
  qualified: "qualified",
  "technical validation": "tech_validation",
  "business validation": "business_validation",
  committed: "committed",
  launched: "launched",
  "closed lost": "closed_lost",
};

/** Partner Central LifeCycle.Stage → ACE stage enum. Fallback: prospect. */
export function mapPcStage(raw: string | null | undefined): AceStage {
  return STAGE_MAP[(raw ?? "").trim().toLowerCase()] ?? "prospect";
}

/** Win/loss derived from the stage (Launched = won, Closed Lost = lost, else open). */
export function mapPcStatus(raw: string | null | undefined): AceStatus {
  const stage = mapPcStage(raw);
  if (stage === "launched") return "won";
  if (stage === "closed_lost") return "lost";
  return "open";
}

function firstAmount(spend: readonly PcExpectedSpend[] | null | undefined): number {
  const raw = spend?.[0]?.Amount;
  const n = raw ? Number.parseFloat(raw) : 0;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Map one Partner Central summary to a mirror row. Null if it has no opportunity id. */
export function toMirrorRow(s: PcOpportunitySummary): MirrorRow | null {
  const externalId = (s.Id ?? "").trim();
  if (!externalId) return null;
  const accountName = (s.Customer?.Account?.CompanyName ?? "").trim();
  const partnerRef = (s.PartnerOpportunityIdentifier ?? "").trim();
  const stageRaw = (s.LifeCycle?.Stage ?? "").trim();
  return {
    externalId,
    name: accountName || partnerRef || externalId,
    accountName,
    stage: mapPcStage(stageRaw),
    status: mapPcStatus(stageRaw),
    amount: firstAmount(s.Project?.ExpectedCustomerSpend),
    awsStageRaw: stageRaw,
  };
}

// ----------------------------------------------------------------------------
// AWS sales-org team mapping (GetAwsOpportunitySummary.OpportunityTeam).
// Minimal local shapes (NOT the AWS SDK types) so this stays unit-testable and
// SDK-version-independent — the client casts the SDK response before calling here.
// ----------------------------------------------------------------------------

export type AwsOrgTitle =
  | "aws_sales_rep"
  | "aws_account_owner"
  | "wwps_pdm"
  | "pdm"
  | "psm"
  | "isv_sm";

export interface AwsTeamMemberRaw {
  readonly BusinessTitle?: string | undefined;
  readonly Email?: string | undefined;
  readonly FirstName?: string | undefined;
  readonly LastName?: string | undefined;
}
export interface AwsOpportunitySummaryResult {
  readonly OpportunityTeam?: readonly AwsTeamMemberRaw[] | undefined;
  readonly Insights?:
    | { readonly EngagementScore?: string | undefined; readonly NextBestActions?: string | undefined }
    | undefined;
}

/** A deduped AWS contact ready to upsert into ace_relationships. */
export interface AwsContactUpsert {
  readonly email: string; // lowercased; the dedup key (required)
  readonly name: string;
  readonly title: AwsOrgTitle;
  readonly role: "seller" | "partner_manager"; // ace_relationships.role
}

// Wire BusinessTitle (AWSSalesRep | AWSAccountOwner | WWPSPDM | PDM | PSM | ISVSM) ->
// local enum. Normalizes by lowercasing + stripping non-alphanumerics so casing/spacing
// never matters. PSA / OpportunityOwner / PartnerAccountManager / unknown -> null.
const TITLE_MAP: Readonly<Record<string, AwsOrgTitle>> = {
  awssalesrep: "aws_sales_rep",
  awsaccountowner: "aws_account_owner",
  wwpspdm: "wwps_pdm",
  pdm: "pdm",
  psm: "psm",
  isvsm: "isv_sm",
};

export function mapAwsTitle(raw: string | null | undefined): AwsOrgTitle | null {
  const key = (raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return TITLE_MAP[key] ?? null;
}

/** Coarse ace_relationships.role for an AWS title (keeps health/manual UI coherent). */
export function roleForTitle(title: AwsOrgTitle): "seller" | "partner_manager" {
  return title === "aws_sales_rep" || title === "aws_account_owner" ? "seller" : "partner_manager";
}

/** Build a dedupable contact from one team member. Null if no email or unknown title. */
export function toAwsContact(m: AwsTeamMemberRaw): AwsContactUpsert | null {
  const title = mapAwsTitle(m.BusinessTitle);
  if (title === null) return null;
  const email = (m.Email ?? "").trim().toLowerCase();
  if (email === "") return null; // email is the dedup key — drop teamless/anonymous members
  const first = (m.FirstName ?? "").trim();
  const last = (m.LastName ?? "").trim();
  const local = email.split("@")[0] ?? "";
  const name = [first, last].filter(Boolean).join(" ") || local || "AWS contact";
  return { email, name, title, role: roleForTitle(title) };
}

/** All resolvable AWS team members on a summary, deduped by email (first title wins). */
export function toAwsTeam(summary: AwsOpportunitySummaryResult): AwsContactUpsert[] {
  const seen = new Set<string>();
  const out: AwsContactUpsert[] = [];
  for (const m of summary.OpportunityTeam ?? []) {
    const c = toAwsContact(m);
    if (!c || seen.has(c.email)) continue;
    seen.add(c.email);
    out.push(c);
  }
  return out;
}

export function engagementScore(s: AwsOpportunitySummaryResult): string {
  return String(s.Insights?.EngagementScore ?? "").slice(0, 60);
}
export function nextBestActions(s: AwsOpportunitySummaryResult): string {
  return (s.Insights?.NextBestActions ?? "").slice(0, 2000);
}
