import { describe, it, expect } from "vitest";
import {
  allowedNext,
  canTransition,
  isOpen,
  isTerminal,
  lifecycleSteps,
  offerSummary,
  matchAgreementForOffer,
  type PrivateOfferStatus,
  type AgreementMatchCandidate,
} from "@/domain/marketplace/private-offers";

describe("private-offer lifecycle", () => {
  it("allows only the valid forward transitions", () => {
    expect(allowedNext("draft")).toEqual(["sent", "withdrawn"]);
    expect(allowedNext("sent")).toEqual(["accepted", "declined", "expired", "withdrawn"]);
    expect(canTransition("draft", "sent")).toBe(true);
    expect(canTransition("draft", "accepted")).toBe(false); // must go through sent
    expect(canTransition("sent", "accepted")).toBe(true);
    expect(canTransition("accepted", "withdrawn")).toBe(false); // terminal
  });

  it("classifies open vs terminal", () => {
    expect(isOpen("draft")).toBe(true);
    expect(isOpen("sent")).toBe(true);
    expect(isOpen("accepted")).toBe(false);
    for (const t of ["accepted", "declined", "expired", "withdrawn"] as PrivateOfferStatus[]) {
      expect(isTerminal(t)).toBe(true);
    }
    expect(isTerminal("draft")).toBe(false);
  });

  it("renders a happy-path stepper and short-circuits terminal outcomes", () => {
    const sent = lifecycleSteps("sent");
    expect(sent.map((s) => s.state)).toEqual(["done", "current", "upcoming"]);
    const declined = lifecycleSteps("declined");
    expect(declined[declined.length - 1]!).toMatchObject({ key: "declined", state: "terminal" });
    expect(lifecycleSteps("accepted").every((s) => s.state === "done" || s.state === "current")).toBe(true);
  });
});

describe("offerSummary", () => {
  it("counts by status and splits in-flight vs accepted value", () => {
    const s = offerSummary([
      { status: "draft", offerValue: 10_000 },
      { status: "sent", offerValue: 20_000 },
      { status: "accepted", offerValue: 50_000 },
      { status: "declined", offerValue: 999 },
    ]);
    expect(s.total).toBe(4);
    expect(s.byStatus.sent).toBe(1);
    expect(s.inFlightValue).toBe(30_000); // draft + sent
    expect(s.acceptedValue).toBe(50_000);
  });
});

describe("matchAgreementForOffer", () => {
  const agreements: AgreementMatchCandidate[] = [
    { id: "a-public", customerIdentifier: "cust-globex", listingId: "L1", offerType: "PublicOffer" },
    { id: "a-private", customerIdentifier: "cust-globex", listingId: "L1", offerType: "PrivateOffer" },
    { id: "a-other", customerIdentifier: "cust-initech", listingId: "L1", offerType: "PrivateOffer" },
  ];

  it("matches by customer + listing and prefers a private offer", () => {
    const m = matchAgreementForOffer({ customerIdentifier: "cust-globex", listingId: "L1" }, agreements);
    expect(m?.id).toBe("a-private");
  });

  it("matches on customer alone when the offer names no listing", () => {
    const m = matchAgreementForOffer({ customerIdentifier: "cust-initech", listingId: null }, agreements);
    expect(m?.id).toBe("a-other");
  });

  it("matches a synced agreement with no local listing (listing is only a tiebreaker)", () => {
    // Agreements synced from AWS carry no local listing id -> match on customer alone.
    const synced: AgreementMatchCandidate[] = [
      { id: "a-synced", customerIdentifier: "cust-globex", listingId: null, offerType: "PrivateOffer" },
    ];
    expect(matchAgreementForOffer({ customerIdentifier: "cust-globex", listingId: "L1" }, synced)?.id).toBe("a-synced");
  });

  it("returns null when nothing matches or the customer is blank", () => {
    expect(matchAgreementForOffer({ customerIdentifier: "cust-nope", listingId: "L1" }, agreements)).toBeNull();
    expect(matchAgreementForOffer({ customerIdentifier: "", listingId: null }, agreements)).toBeNull();
    // Right customer, wrong listing (both known + different) -> no match.
    expect(matchAgreementForOffer({ customerIdentifier: "cust-globex", listingId: "L9" }, agreements)).toBeNull();
  });
});
