import { describe, it, expect } from "vitest";
import { addDays, addMonths, daysBetween, relativeTime } from "@/domain/dates";

describe("addDays / addMonths / daysBetween", () => {
  it("adds and subtracts days across month boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("adds whole months", () => {
    expect(addMonths("2026-01-15", 2)).toBe("2026-03-15");
  });
  it("counts whole days between dates (signed)", () => {
    expect(daysBetween("2026-06-01", "2026-06-08")).toBe(7);
    expect(daysBetween("2026-06-08", "2026-06-01")).toBe(-7);
  });
});

describe("relativeTime", () => {
  const NOW = 1_000_000_000_000; // fixed epoch ms — deterministic
  const S = 1000,
    M = 60_000,
    H = 3_600_000,
    D = 86_400_000;

  it("labels sub-minute spans as 'just now'", () => {
    expect(relativeTime(NOW, NOW)).toBe("just now");
    expect(relativeTime(NOW - 59 * S, NOW)).toBe("just now");
  });
  it("labels minutes, hours, and days", () => {
    expect(relativeTime(NOW - 1 * M, NOW)).toBe("1m ago");
    expect(relativeTime(NOW - 5 * M, NOW)).toBe("5m ago");
    expect(relativeTime(NOW - 4 * H, NOW)).toBe("4h ago");
    expect(relativeTime(NOW - 23 * H, NOW)).toBe("23h ago");
    expect(relativeTime(NOW - 3 * D, NOW)).toBe("3d ago");
  });
  it("falls back to the ISO date at/after 7 days", () => {
    const from = NOW - 8 * D;
    expect(relativeTime(from, NOW)).toBe(new Date(from).toISOString().slice(0, 10));
  });
  it("clamps a future timestamp to 'just now'", () => {
    expect(relativeTime(NOW + 5 * M, NOW)).toBe("just now");
  });
});
