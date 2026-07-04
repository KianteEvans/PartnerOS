import { describe, it, expect } from "vitest";
import { composeMilestones } from "@/domain/roadmaps/compose";

describe("roadmap composer", () => {
  it("returns nothing for an empty selection", () => {
    expect(composeMilestones({ programKeys: [], targetTier: null })).toEqual([]);
  });

  it("composes one ownable milestone per selected program, in catalog order", () => {
    // security comes after migration in the library, so order is normalized.
    const out = composeMilestones({
      programKeys: ["security_competency", "migration_competency"],
      targetTier: null,
    });
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.title)).toEqual([
      "Earn Migration Competency",
      "Earn Security Competency",
    ]);
    expect(out.every((m) => m.originKind === "program")).toBe(true);
    expect(out[0]!.detail).toContain("Requires:");
    expect(out[0]!.originRef).toBe("migration_competency");
  });

  it("fans tier advancement out into one milestone per threshold requirement", () => {
    const out = composeMilestones({ programKeys: [], targetTier: "advanced" });
    // advanced has 6 gating thresholds; the informational annual fee is not a milestone
    expect(out).toHaveLength(6);
    expect(out.every((m) => m.originKind === "tier")).toBe(true);
    expect(out.every((m) => m.originLabel === "Advanced tier")).toBe(true);
    expect(out.every((m) => m.originRef.startsWith("advanced:"))).toBe(true);
    expect(out.some((m) => m.originRef === "advanced:annual_apn_fee")).toBe(false);
    expect(out[0]!.title.startsWith("Advanced tier: ")).toBe(true);
  });

  it("orders programs before tier requirements", () => {
    const out = composeMilestones({
      programKeys: ["isv_accelerate"],
      targetTier: "select",
    });
    expect(out[0]!.originKind).toBe("program");
    expect(out.at(-1)!.originKind).toBe("tier");
  });

  it("ignores unknown program keys", () => {
    expect(
      composeMilestones({ programKeys: ["does_not_exist"], targetTier: null }),
    ).toEqual([]);
  });

  it("treats 'registered' as no advancement target", () => {
    expect(
      composeMilestones({ programKeys: [], targetTier: "registered" }),
    ).toEqual([]);
  });

  it("produces stable, unique keys for owner mapping", () => {
    const out = composeMilestones({
      programKeys: ["migration_competency"],
      targetTier: "select",
    });
    const keys = out.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("program:migration_competency");
    expect(keys.some((k) => k.startsWith("tier:select:"))).toBe(true);
  });
});
