# PartnerOS Service Packages — Packaging Strategy

**Status:** Adopted packaging architecture **v2** (stage-anchored rework of v1, 2026-07-03). Packaging only — no price points; dollar figures are a separate pricing study.
**Scope:** Three tiers (Essentials / Growth / Enterprise), an add-on lane, the services blend, upgrade paths, and the fences that protect each tier's reason-to-buy. This document is the source of truth; the marketing `/pricing` table and any future entitlement enforcement derive from it.

**What changed in v2 (one sentence):** v1 fenced on *feature value* ("the money features are upstairs"); v2 fences on *stage need* — each tier contains what a partner at that stage actually spends their week on, and a fence must read as "not yet," never as "give it back." Full delta in Appendix A.

---

## 1. Positioning summary

### 1.1 The spine: tiers are growth stages

The tier ladder mirrors the AWS Partner Network journey — Registered/Select -> Advanced -> Premier — and each tier is now explicitly a **stage of partnership growth**. As the partnership advances, the package advances with it.

| Tier | Stage | One-line spine |
|---|---|---|
| **Essentials** | **Establish** | "Differentiate and get connected." Everything an early, not-yet-integrated partner spends time on: competencies, evidence, and first AWS relationships. |
| **Growth** | **Scale** | "Turn the partnership into revenue." The money tier for the integrated partner with real deal flow. *Anchor tier — flagged most popular.* |
| **Enterprise** | **Operate** | "Run the alliance as a governed, automated business function." Autonomy with an audit trail, forward planning, and a human advisory layer. |

**The stage math that anchors every boundary** (from the product's own tier-criteria catalog): reaching **Select requires 3 launched ACE opportunities + $1,500 MRR**; **Advanced requires 20 + $10,000**; **Premier 50 + $50,000**. Working a first handful of co-sell deals is not "growth-stage revenue operations" — it is the entry fee to Select, early-stage work by AWS's own definition. v2's allocation follows from this.

The tier path simulator still ships in Essentials and still renders the customer's route to the next APN tier — which is also their route to the next PartnerOS tier. The packaging upsells at the moment the *partnership* levels up.

### 1.2 Stage, ICP, and job-to-be-done

| | **Essentials — Establish** | **Growth — Scale** | **Enterprise — Operate** |
|---|---|---|---|
| **APN stage** | Registered -> Select; first competency in pursuit | Select -> Advanced; co-sell at volume, MDF motion, marketplace presence | Advanced -> Premier; the alliance is a staffed function |
| **Integration depth** | Not yet integrated: no marketplace seller presence, no MDF motion, no assigned field-team gravity | Integrated: PDM/PSM engaged, field teams on deals, seller account live, funding programs in play | Embedded: board-visible relationship; IT, security, procurement own parts of it |
| **Company shape** | 10-100 people; the AWS partnership is a side bet | 50-500; the partnership has a revenue target | 500+; alliance team with a budget, IT owns identity |
| **Buyer persona** | *Founder-with-the-alliance-hat* — CEO/CTO doing APN admin nights and weekends | *The first alliance hire* — OKR'd on launched opportunities, competencies won, MDF claimed | *Alliance ops + IT* — Director of Alliances co-signed by IT security; procurement in the room |
| **How the week is spent** | Chasing certifications; assembling competency evidence; drafting the competency application; standing up first solutions; meeting and keeping warm the first AWS contacts (a PDM, a couple of sellers, an SA); logging and launching the 3 co-sell opportunities Select requires | Triaging a 20-50 deal pipeline; running rep cadence across dozens of AWS field contacts; claiming MDF and matching deals to funding; managing listings and private offers; assembling the QBR packet and defending ROI to the CRO | Reviewing what automation did (not doing it); scenario-planning next year; passing audits; forecasting; governing access for a large org |
| **Success metric reported up** | "We reached Select and submitted our first competency" | "Partner-sourced pipeline and funding recovered" | "Alliance ops runs itself; audit passed; forecast credible" |

A fourth ICP is deliberately **not** a tier: the consultancy/MSP running AWS alliances *for other companies*. They buy the **Agency add-on** (Section 5.2).

---

## 2. Value metric

### 2.1 Primary: role-aware seats

Seats scale within a tier; stage fences carry the tier-to-tier jump.

- A **full seat** = a mutating role (owner / admin / manager / member).
- **Viewer seats are free and unlimited in Growth and Enterprise.** Executives reading QBR packets and health scores are tomorrow's budget approvers; read-only access is the expansion engine, not a meter.
- Seat packs (packaging, not price): **Essentials ~3 seats** (all roles count — stage-appropriate: the founder plus one or two), **Growth ~10 full seats + unlimited viewers**, **Enterprise unlimited**.

Why seats: value tracks the humans coordinating the partnership; seats are countable today with zero metering infrastructure; procurement understands them; and they never punish success on AWS.

### 2.2 Secondary: managed workspaces (Agency add-on only)

An agency's book of clients is its revenue; per-managed-workspace is the honest meter for that ICP.

### 2.3 The do-not-tax list

| Never meter | Why |
|---|---|
| **Benchmarking participation** | Network-effect moat. Cohorts require a minimum of 5 opted-in tenants (k-anonymity); every node you tax is a cohort you starve. |
| **ACE opportunities, MDF claims, funding submissions (volume)** | Never tax behavior AWS pays the customer to perform. Per-deal pricing teaches partners not to log deals, poisoning the data that powers tier auto-measure, health scores, ROI attribution, and benchmarks. |
| **AI queries** | Usage anxiety kills the habit. AI is fenced by tier with an invisible server-side fair-use cap; no customer-visible meters. |
| **Evidence storage / documents** | Do not tax compliance hygiene; a full locker is switching cost in our favor. |
| **Connector sync frequency** | The connector is activation, not consumption (Section 4). |

**v2 corollary — no caps either.** A pipeline cap (e.g., N active opportunities in Essentials) was considered and rejected: it punishes the stage progress this architecture celebrates, produces the same log-avoidance incentive as a meter at the margin, and demands enforcement infrastructure v1 rightly deferred. Volume thresholds live on as upgrade *signals* (Section 6), never walls.

---

## 3. Tier architecture

Each tier has a **leader** — the feature that defines it — plus the fill that completes its stage's job-to-be-done.

### 3.1 Essentials — the Establish stage. Leader: the Readiness System

**Leader:** scored readiness assessments + real AWS tier criteria with auto-measure + the tier path simulator.

Includes: roadmap builder (Gantt, critical path, live reconciliation), evidence locker + program-fit engine, **competency programs end-to-end — Pursue, Prove, and Submit**, **competency applications (.xlsx parse -> AI-drafted responses -> export)**, solutions catalog + renewal readiness, **ACE Relationships & Contacts** (contact records with roles, interaction logging, per-account coverage, strength bands, stale-contact alerts), **the basic co-sell opportunity workspace** (create/edit opportunities, stage tracking, the plain pipeline list, Partner Central sync with reconcile), Command Center core (health score, decision queue, basic next-move), tasks, the onboarding journey, all 5 roles, and benchmarking participation.

Notes on the v2 calls:

- **ACE moves down — records and relationships.** "Establishing new AWS contacts via ACE" is the named early-stage motion, and every feature in the relationships module is volume-independent (a stale-contact alert on your only PDM relationship is worth more than on your fortieth). The basic opportunity workspace comes with it because **Select's gate is 3 launched opportunities** — the entry tier must let partners work their own advancement criteria. The early partner's loop — log deal, update stage, launch, get counted toward Select, keep the PDM warm — closes entirely inside Essentials.
- **Applications move down — the whole workflow.** Differentiation via competencies is the stage's defining job; v1's fence at Submit was a toll booth at the finish line of the work the tier was sold to do. The AI drafting rides along because it grounds entirely on evidence-locker and case-study data — Essentials data top to bottom (see the AI rule, Section 7). This is Essentials' one AI feature.
- **The prescriptive layer still self-fences.** With no MDF/funding/marketplace modules, the decision queue simply produces stage-appropriate items (deal follow-ups, evidence gaps, tier progress) and no cross-domain moves.
- The **tier path simulator** remains the deliberate simulation-moat giveaway: at graduation it renders the Advanced gap — which is the Growth proposal (Section 6, trigger #1).

### 3.2 Growth — the Scale stage. Leader: the Deal Desk

**Leader:** the per-deal Deal Desk — one screen per opportunity fusing funding eligibility, MDF, marketplace agreements, the AWS field team, and ranked next moves. Intrinsically a scale-stage artifact: it fuses modules the early partner does not have. And it demos better in v2 — the prospect's live deals are already in-product from their Essentials days, so the Deal Desk demo runs on their own pipeline.

Includes (everything in Essentials, plus): **the ACE pipeline-management layer** — saved views, priority scoring, the hygiene queue, stage-funnel and win-rate analytics, rep workload, bulk operations (the machinery for more-deals-than-fit-in-your-head), **Rep Intelligence** (computed rep health scoring, re-engagement queue, rollups) + **AWS sales-org sync** (per-opportunity field-team enrichment), co-sell goals, win/loss mining and reports, full MDF lifecycle + event planner + budget + marketing-plan export, AWS Funding catalog + deal-eligibility matcher + submissions tracker, Marketplace (listings, metering, entitlements, billing, PRM) with AWS-authoritative sync + the private-offer bridge, the Reports module (metric history, comparative detail, print/**QBR packet**, CSV/JSON), ROI loops, playbooks in **recommend-only** mode, and three AI features: win/loss narrative, report narrative, marketplace attribution advisor.

Notes:
- **The ACE fence line, precisely:** relationship *ledger* and opportunity *records* are Establish-stage; *portfolio intelligence over dozens of reps* and *pipeline operations at volume* are Scale-stage. The fence lands between workflows, never mid-workflow.
- The QBR packet stays in Growth (the Scale persona's #1 recurring ritual); AI narratives ride with their grounding data (ACE volume, MDF, marketplace); recommend-only playbooks remain the automation trailer.

### 3.3 Enterprise — the Operate stage. Leader: autonomy with an audit trail

Unchanged from v1. **Leader:** automated playbooks + governance sold as one story — rules that act (auto mode, webhooks, scheduled runs) packaged with the append-only audit log, session controls, and DSAR tooling that make autonomy trustworthy.

Includes (everything in Growth, plus): SAML 2.0 SSO + SCIM provisioning; the **forward-planning suite** (scenario planner, what-breaks-next horizon, Monte-Carlo forecasting, partnership graph/causality map); the **Alliance Copilot** (conversational AI grounded in the full cross-section brief); unlimited seats; support SLA.

### 3.4 Master allocation table

| Capability | Tier | Stage rationale (for changed/notable placements) |
|---|---|---|
| Readiness assessments (scored, deltas) | Essentials | Leader. |
| Real AWS tier criteria + auto-measure | Essentials | Now consistent: the launched-count it measures is workable in-tier. |
| Tier path simulator | Essentials | Doubles as the graduation-moment upsell surface. |
| Roadmap builder + live reconciliation | Essentials | |
| Evidence locker + program-fit | Essentials | |
| Case study library | Essentials | |
| Solutions catalog + renewal readiness | Essentials | |
| Competency programs — Pursue, Prove, **Submit** | Essentials | **v2 change.** Stage-1's defining job completes inside stage-1's tier. |
| **Competency applications (.xlsx -> AI draft -> export)** | Essentials | **v2 change.** AI grounds on evidence-locker data; differentiation is the stage-1 job. |
| **ACE Relationships & Contacts** (roles, interactions, coverage, strength, stale alerts) | Essentials | **v2 change.** The directive's named stage-1 motion; volume-independent by construction. |
| **ACE basic opportunity workspace** (records, stages, list, Partner Central sync + reconcile) | Essentials | **v2 change.** Select requires 3 launched opps — never gate a partner's own advancement criteria. |
| Command Center core (health, decision queue, basic next-move) | Essentials | Prescriptive layer self-fences by module availability. |
| Tasks, onboarding journey, invitations, 5 roles | Essentials | Table stakes. |
| Benchmarking (opt-in, k-anon cohorts) | **All tiers** | Network moat; readiness cohorts are the early partner's peer set. |
| Partner Central connector | **All tiers** | Activation, not a fence — doctrine v2 in Section 4. |
| **ACE pipeline-management layer** (saved views, priority scoring, hygiene queue, funnel/win-rate analytics, rep workload, bulk ops) | Growth | The explicit ACE fence line: machinery for more-deals-than-fit-in-your-head. |
| **Deal Desk** (per-deal fusion) | Growth | Leader; fuses Growth-only modules — cannot leak downward even by accident. |
| Rep Intelligence (health scoring, re-engage queue, rollups) | Growth | The ledger is stage-1; portfolio intelligence over dozens of reps is stage-2. |
| AWS sales-org sync (per-opp team enrichment) | Growth | Auto-enrichment pays at volume; early partners log two sellers by hand. |
| Co-sell goals; win/loss mining + reports | Growth | Volume-born; the early partner's co-sell goal IS the tier criteria, already rendered in Essentials. |
| MDF lifecycle + event planner + budget + export | Growth | The MDF motion is integrated-partner behavior (see trade-offs, 7.2). |
| AWS Funding catalog + matcher + submissions | Growth | Funding ops need deal flow to matter. |
| Marketplace 5 pillars + private-offer bridge | Growth | Early partners have no seller presence — the purest "you don't need this yet" fence in the product. |
| Reports module (history, comparative, print/QBR, CSV/JSON) | Growth | Fence rule survives (Section 7). |
| ROI loops (spend -> pipeline -> won) | Growth | Revenue attribution is stage-2 proof work. |
| AI: win/loss narrative, report narrative, attribution advisor | Growth | Grounding data lives here. |
| Playbooks — recommend-only | Growth | The automation trailer. |
| Playbooks — automated + webhooks + scheduled runs | Enterprise | Leader (with governance). |
| Audit log viewer, session revocation, DSAR | Enterprise | Packaged WITH automation as "autonomy with an audit trail." |
| SAML SSO + SCIM | Enterprise | IT is in the room for this buyer only. |
| Scenario planner + what-breaks-next; Monte-Carlo forecasting; partnership graph | Enterprise | Forward-planning suite. |
| **Alliance Copilot** | Enterprise | Grounded on the full cross-section brief — the premium strategic layer. |
| Unlimited seats, SLA | Enterprise | |
| Agency/portfolio mode | **Add-on** | Different ICP, different value metric — Section 5.2. |

---

## 4. Connector doctrine v2: records open, management fenced

The AWS Partner Central connector (cross-account assume-role) remains available in **every tier** — activation, not a fence: the moment a tenant configures the role, PartnerOS becomes their system of record, and Essentials' leader features (tier auto-measure, roadmap reconciliation) run on real data.

**v1's "aggregates-only" rule is retired.** Showing an Essentials customer their own synced deals as a number they could not open was the architecture's cleverest trick and its clearest violation of the stage principle — "we locked your data" wearing a costume. The replacement doctrine:

> **Records open, management fenced.** Any record class a partner's current stage requires them to produce — opportunities, contacts, evidence, applications — is fully visible and workable in every tier that needs it. Fences sit on the machinery for operating those records at volume (saved views, hygiene queues, priority scoring, bulk operations, portfolio intelligence) and on the cross-module fusion layers (Deal Desk).

Marketplace seller sync and AWS sales-team enrichment remain Growth: each only produces value alongside the Scale-stage features it feeds.

---

## 5. Services blend

### 5.1 In-tier service ladder

| | Essentials | Growth | Enterprise |
|---|---|---|---|
| **Onboarding** | Self-serve: in-product activation checklist — now including connector setup **and first-contacts entry** (log your PDM/SA, sync your first opportunities) — docs, community | **Guided (~30 days):** historical data import, pipeline-management configuration, first MDF claim, first Deal Desk review (ACE itself is already live from Essentials days) | **White-glove:** named implementation lead, SSO/SCIM rollout with IT, security review/DPA support, playbook design workshop |
| **Ongoing success** | Community + monthly group office hours | **Quarterly success review** timed to the customer's AWS QBR cadence — the product's QBR packet is the agenda | **Named CSM + alliance advisory:** QBR co-preparation, competency application review, annual alliance strategy session |
| **Support** | Email, standard | Priority email/chat | Priority + response-time SLA, escalation path |

Principle: **services fence on human time, never on withholding artifacts.**

### 5.2 Add-on lane (deliberately outside all tiers)

1. **Agency edition** — for consultancies/MSPs running alliances for clients. Multi-workspace portfolio + act-as + consent-based linking, **on an Enterprise base**, priced **per managed workspace**. Anti-arbitrage floor: >= ~70% of a direct Growth workspace.
2. **Managed Alliance Ops retainer** — our staff run ACE hygiene, MDF claims, and funding submissions inside the customer's workspace, delivered through agency mode.
3. **Competency Application Sprint** — fixed-scope engagement wrapped around one competency submission. **Repositioned in v2:** the natural *Essentials-native* attach — human help riding on tooling the customer already owns, sold at the moment an application is started or a first draft is generated (no longer a Growth demo vehicle).
4. **Migration / white-glove data import** — spreadsheets-to-locker for customers leaving "alliance ops in Excel."

---

## 6. Upgrade paths

All observable in product data today; no new metering. Triggers 1-4 are **stage-transition signals** — the packaging upsells at the moment the partnership levels up, the most defensible upsell in SaaS. (Retired from v1: the synced-but-locked opportunity list and the paywall at Submit — both replaced by honest stage signals.)

| # | Observable signal | Move | The pitch at that moment |
|---|---|---|---|
| 1 | **Select attained** — tier auto-measure confirms it; the simulator renders the Advanced gap (20 launched opportunities, $10K MRR, sustained co-sell) | Essentials -> Growth | "You graduated. Advanced is co-sell at scale — pipeline triage, rep intelligence, MDF, the Deal Desk. That's Growth." The graduation screen is the proposal document. |
| 2 | **Pipeline volume outgrows a list** — active opportunities cross ~10, or the contact ledger passes ~15 relationships with a re-engagement backlog | Essentials -> Growth | "Your pipeline outgrew a list. Hygiene, priority scoring, rep intelligence, and the Deal Desk are waiting." |
| 3 | **Competency won** — an application flips to active | Essentials -> Growth | "Competency partners get MDF and field attention. Claim it — the MDF lifecycle and funding matcher are in Growth." A celebration, not a paywall. |
| 4 | **Integration-intent signals** — first marketplace/seller-connect intent, a deal profile matching funding-program shapes, first MDF grant | Essentials -> Growth | "You're starting to transact inside the AWS ecosystem — this is the stage Growth was built for." |
| 5 | Seat cap hit / invite blocked | Next tier | More humans on the alliance = the partnership got real. |
| 6 | Recommend-only playbook acceptance streak | Growth -> Enterprise | "You've approved this move 11 times. Let a playbook do it — with an audit log." |
| 7 | SSO/SCIM inquiry or security questionnaire | Growth -> Enterprise | IT just entered the deal; the governance suite closes it. |
| 8 | Agency link request / second workspace | Agency add-on | The consent handshake is itself the buying signal. |

Strategy note (unchanged): triggers 1-4 eventually belong in the decision queue as next-best-actions — no build commitment now.

---

## 7. Fence rules, risks, and deliberate trade-offs

### 7.1 Standing rules

**Unchanged from v1:**
- **The do-not-tax list** (Section 2.3) — now with the explicit no-caps corollary.
- **Viewer seats free in Growth+.**
- **Reports fence:** Essentials sees current state + last delta in-feature; history, comparison, narrative, and export belong to Reports (Growth). Stage-consistent: the early partner *tracks* progress; the scaling partner *proves* it to others.
- **Services fence on human time, never artifacts.**
- **Agency floor** (~70% of a direct Growth workspace).
- **A fence resolves to an upgrade screen, never a 404 or error.**

**Changed:**
- ~~Pipe-vs-workspace (aggregates-only)~~ -> **Records open, management fenced** (Section 4).

**New in v2 — the stage frame as rules:**
1. **Never fence stage-progress data.** Anything AWS counts toward the customer's tier advancement — launched opportunities, competencies, certifications, contacts — is visible *and workable* in every tier whose stage requires producing it. Fences sit on volume machinery and cross-module fusion, never on the advancement ledger.
2. **The "not yet" test.** Every fence must be one the below-tier persona would themselves agree they don't need yet (marketplace with no listing; win/loss mining with four closed deals). If the stage-correct persona says "I need this now and it's locked," the fence is at the wrong altitude. This is the review gate for all future packaging changes.
3. **AI rides with its grounding data.** Application drafting (evidence-grounded) is Essentials; the narrative trio (ACE/MDF/marketplace-grounded) is Growth; the Copilot (full cross-section brief) is Enterprise.

### 7.2 Deliberate trade-offs (v2)

1. **Fat Essentials, accepted.** The entry tier now carries programs end-to-end, applications with AI, and real ACE capability. Chosen because the stage demands it; the compensations are honest: Growth keeps the entire money loop plus every volume tool, and the retired "synced-but-locked" hook is replaced by graduation-moment upsells. One named cost: Growth's acquisition front door softens from "get your pipeline at all" to "run your pipeline at scale + the Deal Desk" — a softer hook but a truer one.
2. **MDF stays wholly in Growth** despite AWS granting occasional MDF to smaller partners. The exception does not define the stage: the MDF surface is a lifecycle machine (claims, event planner, budget, compliance) built for a motion, not a grant. A "starter MDF" slice would fence mid-lifecycle later. An Essentials partner's rare grant is trackable as tasks + evidence; the first real MDF activity is trigger #4, and it will fire.
3. **No pipeline cap** (Section 2.3 corollary) — the threshold lives on as trigger #2, a signal instead of a wall.
4. **Tier path simulator still given away** in Essentials; the deeper simulation surface (scenario planner, horizon, Monte-Carlo) stays in Enterprise.
5. **Benchmarking unfenced everywhere** — the network moat needs nodes more than any tier needs an exclusive.

### 7.3 Leak analysis

- **Essentials ACE vs Growth's reason-to-buy.** Mitigation is the workflow-fence test: the records/management line means the early loop closes in Essentials while the volume loop (triage/hygiene/intelligence/fusion) only exists in Growth. Growth remains decisively the anchor: Deal Desk (leader), pipeline management at volume, rep intelligence + sales-org sync, the entire money loop (MDF/funding/marketplace/offers), proof (Reports/QBR/ROI + AI narratives), recommend-only playbooks, seats, and the guided-onboarding service layer. No rebalancing needed.
- **In-feature progress views vs the Reports module** — fence rule held (7.1).
- **QBR packet in Growth vs Enterprise services** — unchanged; human time is the fence.
- **Entitlement note:** the v2 fence line inside ACE is *view-level*, not page-level — the ACE surface is already segmented into views (pipeline management, win/loss, reps, goals), so each fenced view can resolve to an in-page upgrade panel. Compatible with the future `can()`-adjacent entitlement map from Section 8; still zero metering infrastructure.

---

## 8. Future entitlement enforcement (engineering note, non-binding)

No billing/entitlement system exists today (`tenants.tier` is the AWS partner tier, not a plan). When enforcement is built, the seams already exist:

- **`can(role, permission)` chokepoint** (`src/authz/permissions.ts`) — a per-tenant plan/entitlement check slots in beside the role check.
- **View-level ACE fencing** — the ACE page renders segmented views; fenced views (pipeline management, reps, win/loss, goals) resolve to in-page upgrade panels.
- **`automation_mode` enum** (`src/db/schema.ts`) — the Growth/Enterprise playbook fence is a one-enum gate.
- **`tenants.is_agency` / `agency_id` + `agency_link_requests`** — the Agency add-on is already modeled and countable.
- **Server-side AI gating** — per-feature enable checks + existing rate limiters for fair use.
- **Membership counts per tenant** — seat enforcement needs no new metering.

Proposed shape: a `tenants.plan` column + a static entitlement map consulted alongside `can()`; every fence resolves to an upgrade screen, never an error. **v2, like v1, requires zero metering infrastructure.**

---

## 9. Marketing surface spec (sections.tsx TIERS rewrite — SPEC ONLY, no code change now)

When `/pricing` is aligned to v2, the `TIERS` array (`src/components/marketing/sections.tsx:454-497`) should read:

- **Essentials** — "Differentiate and get connected." Readiness Assessments + real AWS tier criteria; Tier Path Simulator; Roadmap Builder; Evidence Locker + program fit; Competency programs end-to-end with AI-drafted applications; AWS contacts & relationship tracking; Co-sell opportunity pipeline with Partner Central sync; Solutions & renewal readiness; Command Center health + decision queue; ~3 seats.
- **Growth** (most popular) — "Turn the partnership into revenue." Everything in Essentials, plus: Deal Desk; Pipeline management at volume + Rep Intelligence + AWS sales-team sync; MDF + Event Planner; AWS Funding matcher & submissions; Marketplace suite + private offers; Reports, ROI loops & QBR packet; AI narratives & attribution advisor; Playbooks (recommendations); ~10 full seats + unlimited viewers; guided onboarding + quarterly success reviews.
- **Enterprise** — "Autonomy with an audit trail." Everything in Growth, plus: Automated Playbooks + audit log & session governance; SAML SSO + SCIM; DSAR tooling; Scenario planner, forecasts & partnership graph; Alliance Copilot; unlimited seats; named CSM + alliance advisory; SLA.
- Footnote row: **Agency edition** (per managed workspace, on Enterprise) and **Managed Alliance Ops** available as add-ons.

---

## Appendix A — v1 -> v2 delta (the stage rework)

| Capability / rule | v1 | v2 | Why |
|---|---|---|---|
| ACE Relationships & Contacts (+ interactions, coverage, stale alerts) | Growth | **Essentials** | The directive's named stage-1 motion ("establishing new AWS contacts via ACE"); volume-independent by construction. |
| ACE opportunity records (CRUD, stages, list, Partner Central sync + reconcile) | Growth (Essentials saw aggregates only) | **Essentials** | Select's gate is 3 launched opportunities; the entry tier must let partners work their own advancement criteria. |
| Connector doctrine | "Pipe in all tiers, aggregates-only below Growth" | **"Records open, management fenced"** | Synced-but-locked data is "we locked your data" — the posture the stage frame rejects. |
| Competency programs — Submit stage | Growth | **Essentials** | Stage-1's defining act; the v1 fence read as a toll booth, not a "not yet." |
| Competency applications (.xlsx -> AI draft -> export) | Growth | **Essentials** | The AI grounds on evidence-locker data (Essentials data top to bottom). |
| ACE pipeline-management layer (views, scoring, hygiene, funnel, workload, bulk) | Growth (implicit) | **Growth — now the explicit fence line** | Clarification: names precisely what stays up when records move down. |
| Rep intelligence vs relationships | One Growth bundle | **Split: ledger Essentials, portfolio intelligence Growth** | The module seam already exists in the product. |
| Essentials AI | None | **One feature: application drafting** | New rule: AI rides with its grounding data. |
| Essentials tagline | "Get partner-ready" | **"Differentiate and get connected"** | The tier now contains real connection work, not just readiness paperwork. |
| Upgrade trigger: synced-but-locked deal list | Core trigger #1 | **Retired** | Replaced by the graduation trigger (Select attained). |
| Upgrade trigger: program reaches Submit | Core trigger #3 | **Retired** | Replaced by the competency-win celebration trigger. |
| Application Sprint (add-on) positioning | Growth-bridge demo | **Essentials-native accelerator** | The tooling now lives where the stage lives. |
| Stage names on tiers | Implicit | **Explicit: Establish / Scale / Operate** | The tier ladder is the growth-stage ladder. |
| New rules | — | **Never fence stage-progress data; the "not yet" test; AI rides with grounding data; no caps** | The stage frame, operationalized. |

Everything not listed is unchanged from v1: the entire Enterprise tier, the add-on lane, seat packs, the do-not-tax list, viewers-free, the Reports fence, services principles, and the v0 critique below.

## Appendix B — Critique of the v0 pricing table (retained from v1)

The shipped marketing table (`Team / Growth / Enterprise`) predates roughly 25 current capabilities. Corrections carried into v2: "Team" renamed Essentials; the differentiated 60% (Deal Desk, funding, marketplace, ROI, forecasts, playbooks, benchmarking, AI, agency) was unpackaged; "Command Center" wholesale at the bottom tier leaked the prescriptive/simulation layers; "role-based permissions" is plumbing, not an Enterprise feature; v0 Enterprise had no positive reason-to-buy; Solutions belonged with evidence, not revenue. v2 additionally corrects v1's own aggregates-only fence and Submit paywall (Appendix A).

## Appendix C — Glossary

- **APN** — AWS Partner Network; partner tiers: Registered, Select, Advanced, Premier. Select requires 3 launched co-sell opportunities + $1,500 MRR; Advanced 20 + $10,000; Premier 50 + $50,000.
- **ACE** — APN Customer Engagements: AWS's co-sell program and pipeline-sharing system.
- **MDF** — Market Development Funds: AWS money for partner marketing activities.
- **AWS Funding programs** — the broader catalog (POC funding, migration incentives, etc.) beyond MDF.
- **Competency / Specialization** — AWS designations earned by evidencing capability in a domain; renewed periodically.
- **FTR** — Foundational Technical Review; prerequisite for certain solution designations.
- **Co-sell** — jointly selling with AWS field teams via shared ACE opportunities.
- **Private offer** — a negotiated AWS Marketplace transaction for a specific customer.
- **QBR** — Quarterly Business Review with the AWS partner team.
- **PDM / PSM / SA** — Partner Development Manager / Partner Solutions Manager / Solutions Architect: the AWS-side contacts an early partner cultivates.
- **k-anonymity (benchmarking)** — cohort statistics are only shown when at least 5 tenants contribute.
