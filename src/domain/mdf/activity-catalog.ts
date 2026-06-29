/**
 * The AWS MDF activity catalog: the program guide's list of ELIGIBLE (approved)
 * and INELIGIBLE (unapproved) marketing activity types, transcribed faithfully so
 * the event planner can ground each candidate event in a real AWS rule. Pure
 * static reference data — mirrors `src/domain/programs/library.ts`.
 *
 * `category` maps each activity onto the existing `mdf_activity_type` enum so a
 * planned item (and the request it becomes) carries a consistent activity type.
 */

export type ActivityCategory = "event" | "campaign" | "content" | "enablement" | "other";
export type ActivityEligibility = "approved" | "ineligible";

export interface CatalogActivity {
  readonly key: string;
  readonly label: string;
  readonly category: ActivityCategory;
  readonly eligibility: ActivityEligibility;
  readonly description: string;
  /** Proof-of-performance requirement at claim time (approved activities). */
  readonly proofRequirement?: string;
  /** Why AWS won't fund it (ineligible activities). */
  readonly reason?: string;
  /** Special rule worth surfacing (e.g. "must sponsor the AWS event"). */
  readonly notes?: string;
  /** AWS co-fund share of the total activity cost, percent. 50 for approved, 0 for ineligible. */
  readonly defaultCoFundPct: number;
}

/** Standard claim-time proof for most approved activities. */
const RECEIPTS = "Third-party receipts showing actual incurred costs, dated after fund request approval.";

const APPROVED: readonly CatalogActivity[] = [
  {
    key: "aws-led-joint-campaign",
    label: "AWS Led Joint Campaign (Invite Only)",
    category: "event",
    eligibility: "approved",
    description:
      "An in-person or virtual event showcasing your AWS solution to end customers (networking, sporting, roundtables, partner-hosted). Highlights value that AWS and select Competency Partners deliver.",
    proofRequirement: RECEIPTS,
    notes: "Invite only.",
    defaultCoFundPct: 50,
  },
  {
    key: "customer-webinar",
    label: "Customer-Focused Webinar",
    category: "enablement",
    eligibility: "approved",
    description:
      "Webinars led by AWS Partners focused exclusively on the Partner's solutions on AWS, or joint events with other vendors that demonstrate your AWS solution.",
    proofRequirement: RECEIPTS,
    defaultCoFundPct: 50,
  },
  {
    key: "display-search-marketing",
    label: "Display Advertising & Search Marketing",
    category: "campaign",
    eligibility: "approved",
    description: "Advertising support across display, paid search, SEO, and social media.",
    proofRequirement: RECEIPTS,
    defaultCoFundPct: 50,
  },
  {
    key: "email-campaign",
    label: "Email Campaign",
    category: "campaign",
    eligibility: "approved",
    description:
      "Templates, design, and execution (e.g. Marketo, Eloqua); web copy; landing pages; microsites; design and development.",
    proofRequirement: RECEIPTS,
    defaultCoFundPct: 50,
  },
  {
    key: "industry-conference",
    label: "Industry Conference Event",
    category: "event",
    eligibility: "approved",
    description:
      "Participation in a third-party industry or technology conference to showcase your AWS solutions.",
    proofRequirement: RECEIPTS,
    defaultCoFundPct: 50,
  },
  {
    key: "lead-list-purchase",
    label: "Lead List Purchase",
    category: "campaign",
    eligibility: "approved",
    description: "List purchase; list enhancement / enrichment.",
    proofRequirement: RECEIPTS,
    defaultCoFundPct: 50,
  },
  {
    key: "customer-event-aws-led",
    label: "Customer Event (alongside an AWS-led Event)",
    category: "event",
    eligibility: "approved",
    description:
      "Networking events focused exclusively on your AWS solutions, run alongside AWS events (e.g. re:Invent, Summits).",
    proofRequirement: RECEIPTS,
    notes: "Requires sponsoring the AWS event and complying with AWS Sponsorship Rules & Guidelines.",
    defaultCoFundPct: 50,
  },
  {
    key: "partner-case-study",
    label: "Partner-Produced Case Study (Written/Video)",
    category: "content",
    eligibility: "approved",
    description: "A customer case study on a completed deployment that showcases your AWS solutions.",
    proofRequirement: RECEIPTS,
    defaultCoFundPct: 50,
  },
  {
    key: "partner-sales-content",
    label: "Partner Sales Content",
    category: "content",
    eligibility: "approved",
    description:
      "Development and design of Partner marketing and sales content (whitepaper, e-book, solution brief, technical brief, landing pages) that showcases your AWS solutions.",
    proofRequirement: RECEIPTS,
    defaultCoFundPct: 50,
  },
  {
    key: "partner-sko",
    label: "Partner Sales Kick Off (SKO)",
    category: "event",
    eligibility: "approved",
    description: "An AWS Partner event focused on your annual sales strategy and go-to-market with AWS.",
    proofRequirement: "Invoices showing the cost of sponsorship (SKOs require invoices, not just receipts).",
    defaultCoFundPct: 50,
  },
  {
    key: "telemarketing",
    label: "Telemarketing Campaign",
    category: "campaign",
    eligibility: "approved",
    description:
      "Call campaigns and supporting assets (battlecard, sales-call script, first-call deck, telesales outreach) that showcase your AWS solutions.",
    proofRequirement: RECEIPTS,
    defaultCoFundPct: 50,
  },
  {
    key: "swag",
    label: "Swag",
    category: "other",
    eligibility: "approved",
    description: "Logo items specifically associated with an MDF activity or AWS marketing campaign.",
    proofRequirement: RECEIPTS,
    notes: "Must be tied to a funded MDF activity.",
    defaultCoFundPct: 50,
  },
  {
    key: "social-recreational",
    label: "Social/Recreational Event",
    category: "event",
    eligibility: "approved",
    description:
      "Social and recreational costs for training or marketing events that showcase your AWS solutions, where AWS provides the opportunity to participate plus training and materials.",
    proofRequirement: RECEIPTS,
    notes: "Must be tied to a funded MDF activity.",
    defaultCoFundPct: 50,
  },
  {
    key: "video-conferencing",
    label: "Video Conferencing",
    category: "event",
    eligibility: "approved",
    description:
      "Cost to host video-conference services (Zoom, GoToMeeting, WebEx) for events that showcase your AWS solutions.",
    proofRequirement: RECEIPTS,
    defaultCoFundPct: 50,
  },
  {
    key: "catering",
    label: "Catering",
    category: "event",
    eligibility: "approved",
    description:
      "Catering of food, beverages, and gratuities for an event that showcases your AWS solutions. Food vouchers for virtual events (DoorDash, Grubhub, Postmates) are included.",
    proofRequirement: RECEIPTS,
    notes: "Alcohol is reimbursable only when food is also served and itemized on the invoice.",
    defaultCoFundPct: 50,
  },
  {
    key: "skill-builder",
    label: "AWS Skill Builder",
    category: "enablement",
    eligibility: "approved",
    description: "Offset the usage of AWS Skill Builder.",
    proofRequirement: "An AWS receipt as proof of cost.",
    defaultCoFundPct: 50,
  },
  {
    key: "third-party-event",
    label: "3P Event",
    category: "event",
    eligibility: "approved",
    description:
      "50% co-marketing of a third-party event. Can be led by AWS or the Partner.",
    proofRequirement: "Third-party receipts; AWS-led events require an invoice from AWS as proof of performance.",
    notes: "Excludes AWS Summits, re:Invent, and AWS Symposiums.",
    defaultCoFundPct: 50,
  },
];

const INELIGIBLE: readonly CatalogActivity[] = [
  {
    key: "relationship-events",
    label: "Relationship / Networking-only Events",
    category: "event",
    eligibility: "ineligible",
    description: "Events that are networking-only or for morale building.",
    reason: "AWS will not approve events that are networking-only and not focused on an AWS Partner solution.",
    defaultCoFundPct: 0,
  },
  {
    key: "aws-staff-activity",
    label: "AWS Staff Activity",
    category: "other",
    eligibility: "ineligible",
    description: "Gifts, entertainment, or business costs for AWS employees.",
    reason: "Costs for AWS employees are not covered — thank-you gifts, conference tickets for AWS staff, etc.",
    defaultCoFundPct: 0,
  },
  {
    key: "headcount",
    label: "Headcount",
    category: "other",
    eligibility: "ineligible",
    description: "Funding staff, recruiting events, or employee wages.",
    reason: "MDF can't fund staff unless directly tied to a funded activity (e.g. event staff). Excludes recruiting and temp/permanent wages.",
    defaultCoFundPct: 0,
  },
  {
    key: "charity-donations",
    label: "Charity Donations",
    category: "other",
    eligibility: "ineligible",
    description: "Charitable donations.",
    reason: "MDF can't be used to fund charitable donations.",
    defaultCoFundPct: 0,
  },
  {
    key: "aws-sponsored-event-fees",
    label: "AWS-Sponsored Event Fees",
    category: "event",
    eligibility: "ineligible",
    description: "Sponsorship, tickets, or meeting-room fees for AWS-led events (re:Invent, Summits).",
    reason: "MDF can't offset fees around AWS-led events. AWS sponsorship guidelines apply.",
    defaultCoFundPct: 0,
  },
  {
    key: "cancellation-fees",
    label: "Cancellation Fees",
    category: "other",
    eligibility: "ineligible",
    description: "Deposits or costs already incurred for a cancelled activity.",
    reason: "Costs are not covered if the activity is cancelled.",
    defaultCoFundPct: 0,
  },
  {
    key: "travel",
    label: "Travel & Accommodation",
    category: "other",
    eligibility: "ineligible",
    description: "Flights, hotels, individual meals, and transportation (taxis, ride shares, buses).",
    reason: "No travel or accommodation is covered — including costs incurred by the Partner, AWS staff, or third-party vendors.",
    defaultCoFundPct: 0,
  },
  {
    key: "internal-costs",
    label: "Internal / In-house Costs",
    category: "other",
    eligibility: "ineligible",
    description: "Internal hours, in-house creative/marketing, or employee costs.",
    reason: "AWS only pays third-party agency costs — no internal hours or in-house FTE/temp/contract resources.",
    defaultCoFundPct: 0,
  },
  {
    key: "business-costs",
    label: "AWS Partner Business Costs",
    category: "other",
    eligibility: "ineligible",
    description: "Normal business expenses, overhead, or capital expenditures.",
    reason: "MDF can't be used for normal operational expenses, overhead, or capex.",
    defaultCoFundPct: 0,
  },
  {
    key: "amazon-merchandise",
    label: "Amazon.com Merchandise",
    category: "other",
    eligibility: "ineligible",
    description: "Amazon.com gift cards, Echos, Kindles, Echo Dots, Echo Shows, etc.",
    reason: "MDF can't be used to buy Amazon.com merchandise.",
    defaultCoFundPct: 0,
  },
  {
    key: "alcohol-only",
    label: "Alcohol-only",
    category: "other",
    eligibility: "ineligible",
    description: "Activities where only alcohol is consumed.",
    reason: "Alcohol is reimbursable only when food is also served and itemized; alcohol-only is not eligible.",
    defaultCoFundPct: 0,
  },
  {
    key: "rush-fees",
    label: "Rush Fees",
    category: "other",
    eligibility: "ineligible",
    description: "Additional fees for expedited or rush jobs.",
    reason: "Rush/expedite fees are not reimbursable.",
    defaultCoFundPct: 0,
  },
  {
    key: "customer-incentives",
    label: "Customer Incentives",
    category: "other",
    eligibility: "ineligible",
    description: "Incenting customers (e.g. $500 in MDF for a public reference).",
    reason: "MDF cannot be used to incent customers. (A case study on a completed deployment is allowed instead.)",
    defaultCoFundPct: 0,
  },
  {
    key: "spifs",
    label: "SPIFs",
    category: "other",
    eligibility: "ineligible",
    description: "Sales performance incentive funds.",
    reason: "SPIFs are not eligible activities.",
    defaultCoFundPct: 0,
  },
];

export const ACTIVITY_CATALOG: readonly CatalogActivity[] = [...APPROVED, ...INELIGIBLE];
export const APPROVED_ACTIVITIES: readonly CatalogActivity[] = APPROVED;
export const INELIGIBLE_ACTIVITIES: readonly CatalogActivity[] = INELIGIBLE;

const BY_KEY = new Map(ACTIVITY_CATALOG.map((a) => [a.key, a]));

export function activityByKey(key: string | null | undefined): CatalogActivity | undefined {
  return key == null ? undefined : BY_KEY.get(key);
}

/** Catalog activities for a given mdf_activity_type category (approved first). */
export function activitiesByCategory(category: ActivityCategory): CatalogActivity[] {
  return ACTIVITY_CATALOG.filter((a) => a.category === category);
}
