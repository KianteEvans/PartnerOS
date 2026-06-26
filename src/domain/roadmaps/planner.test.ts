import { describe, it, expect } from "vitest";
import {
  planRoadmap,
  defaultSeeds,
  type MilestoneSeed,
} from "@/domain/roadmaps/planner";

const START = "2026-01-01";

describe("roadmap planner", () => {
  it("uses the default scaffold when no seeds are given", () => {
    const out = planRoadmap(
      { horizon: "m6", scenario: "standard", startDate: START, objective: "Premier tier" },
      [],
    );
    expect(out).toHaveLength(defaultSeeds("Premier tier").length);
    expect(out[0]!.title).toBe("Establish baseline & owners");
  });

  it("uses provided seeds and preserves their order", () => {
    const seeds: MilestoneSeed[] = [
      { title: "A", detail: "a" },
      { title: "B", detail: "b" },
      { title: "C", detail: "c" },
    ];
    const out = planRoadmap(
      { horizon: "m6", scenario: "standard", startDate: START, objective: "" },
      seeds,
    );
    expect(out.map((m) => m.title)).toEqual(["A", "B", "C"]);
  });

  it("numbers sequences and wires a linear dependency chain", () => {
    const out = planRoadmap(
      { horizon: "m12", scenario: "standard", startDate: START, objective: "x" },
      [],
    );
    expect(out.map((m) => m.sequence)).toEqual([1, 2, 3, 4]);
    expect(out.map((m) => m.dependsOnSequence)).toEqual([null, 1, 2, 3]);
  });

  it("produces strictly increasing target dates after the start", () => {
    const out = planRoadmap(
      { horizon: "m9", scenario: "standard", startDate: START, objective: "x" },
      [],
    );
    expect(out[0]!.targetDate > START).toBe(true);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.targetDate > out[i - 1]!.targetDate).toBe(true);
    }
  });

  it("accelerated front-loads vs conservative for the same config", () => {
    const base = { horizon: "m12" as const, startDate: START, objective: "x" };
    const acc = planRoadmap({ ...base, scenario: "accelerated" }, []);
    const con = planRoadmap({ ...base, scenario: "conservative" }, []);
    expect(acc.at(-1)!.targetDate < con.at(-1)!.targetDate).toBe(true);
  });

  it("a longer horizon pushes the final milestone later", () => {
    const base = { scenario: "standard" as const, startDate: START, objective: "x" };
    const short = planRoadmap({ ...base, horizon: "m3" }, []);
    const long = planRoadmap({ ...base, horizon: "m18" }, []);
    expect(long.at(-1)!.targetDate > short.at(-1)!.targetDate).toBe(true);
  });
});
