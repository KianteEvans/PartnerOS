import { describe, it, expect } from "vitest";
import { renderNotification, webhookPayload, canonicalPayload } from "./deliver";
import type { Decision } from "@/domain/command/brief";

const decision: Decision = {
  id: "funding-42",
  severity: "high",
  situation: "funding_deadline",
  title: "Funding deadline: MAP",
  detail: "Respond by 2026-07-13.",
  ownerUserId: "u1",
  dueDate: "2026-07-13",
  link: "/funding/submissions/42",
};

describe("notification rendering", () => {
  it("maps the decision onto the persisted notification, with a per-playbook dedupe key", () => {
    const n = renderNotification(decision, { id: "pb1", name: "Funding chaser" });
    expect(n.title).toBe("Funding deadline: MAP");
    expect(n.body).toBe("Respond by 2026-07-13.");
    expect(n.link).toBe("/funding/submissions/42");
    expect(n.severity).toBe("high");
    expect(n.dedupeKey).toBe("pb1:funding-42");
  });

  it("builds a stable webhook payload + canonical JSON", () => {
    const p = webhookPayload(decision, "Funding chaser");
    expect(p).toEqual({
      type: "notification",
      severity: "high",
      situation: "funding_deadline",
      title: "Funding deadline: MAP",
      detail: "Respond by 2026-07-13.",
      link: "/funding/submissions/42",
      playbook: "Funding chaser",
    });
    // canonical string is deterministic (used for both send + HMAC signing).
    expect(canonicalPayload(p)).toBe(canonicalPayload(webhookPayload(decision, "Funding chaser")));
  });
});
