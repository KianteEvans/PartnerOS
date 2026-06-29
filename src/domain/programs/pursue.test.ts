import { describe, it, expect } from "vitest";
import { topPursued, type PursuitInput } from "@/domain/programs/pursue";
import type { RequirementState } from "@/domain/programs/gate";

const TODAY = "2026-06-28";

/** Build requirement states: `met` met (first `approved` of them evidence-approved), `open`, `blocked`. */
function states(spec: { met?: number; open?: number; blocked?: number; approved?: number }): RequirementState[] {
  const met = spec.met ?? 0;
  const approved = spec.approved ?? met;
  const out: RequirementState[] = [];
  for (let i = 0; i < met; i++) out.push({ status: "met", evidenceApproved: i < approved });
  for (let i = 0; i < (spec.open ?? 0); i++) out.push({ status: "open", evidenceApproved: false });
  for (let i = 0; i < (spec.blocked ?? 0); i++) out.push({ status: "blocked", evidenceApproved: false });
  return out;
}

function inp(over: Partial<PursuitInput> & { id: string; name: string; states: RequirementState[] }): PursuitInput {
  return { programType: "Competency", status: "pending", expirationDate: null, ...over };
}

describe("topPursued", () => {
  it("includes only in-flight (pending/submitted); excludes active + expired", () => {
    const top = topPursued(
      [
        inp({ id: "a", name: "A", status: "pending", states: states({ met: 1, open: 1 }) }), // 50%
        inp({ id: "b", name: "B", status: "submitted", states: states({ met: 2 }) }), // 100%
        inp({ id: "c", name: "C", status: "active", states: states({ met: 2 }) }), // excluded
        inp({ id: "d", name: "D", status: "expired", states: states({ open: 2 }) }), // excluded
      ],
      TODAY,
    );
    expect(top.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("ranks by readiness % desc, then total desc, then name asc", () => {
    const top = topPursued(
      [
        inp({ id: "x", name: "Xeon", states: states({ met: 1, open: 1 }) }), // 50%, total 2
        inp({ id: "y", name: "Yak", states: states({ met: 2, open: 2 }) }), // 50%, total 4
        inp({ id: "z", name: "Zed", states: states({ met: 3 }) }), // 100%, total 3
      ],
      TODAY,
    );
    expect(top.map((t) => t.id)).toEqual(["z", "y", "x"]); // 100 first; 50% tie -> bigger total (y) first
  });

  it("breaks remaining ties by name", () => {
    const top = topPursued(
      [
        inp({ id: "b", name: "Beta", states: states({ met: 1, open: 1 }) }),
        inp({ id: "a", name: "Alpha", states: states({ met: 1, open: 1 }) }),
      ],
      TODAY,
    );
    expect(top.map((t) => t.name)).toEqual(["Alpha", "Beta"]);
  });

  it("caps at the limit (default 5)", () => {
    const many = Array.from({ length: 7 }, (_, i) => inp({ id: `p${i}`, name: `P${i}`, states: states({ open: 1 }) }));
    expect(topPursued(many, TODAY)).toHaveLength(5);
    expect(topPursued(many, TODAY, 3)).toHaveLength(3);
  });

  it("surfaces the gate + handles a 0-requirement program", () => {
    expect(topPursued([], TODAY)).toEqual([]);
    const [z] = topPursued([inp({ id: "z", name: "Z", states: [] })], TODAY);
    expect(z).toMatchObject({ percent: 0, total: 0, met: 0, gate: "in_progress" });

    const [r] = topPursued([inp({ id: "r", name: "R", status: "submitted", states: states({ met: 2, approved: 2 }) })], TODAY);
    expect(r).toMatchObject({ percent: 100, gate: "ready_for_roadmap" });
  });
});
