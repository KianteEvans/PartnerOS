import { describe, it, expect } from "vitest";
import { tableView } from "@/domain/marketplace/table-view";

interface Row {
  readonly name: string;
  readonly qty: number;
}

const rows: Row[] = [
  { name: "Beta", qty: 3 },
  { name: "Acme", qty: 1 },
  { name: "Gamma", qty: 2 },
];

const opts = {
  search: (r: Row) => r.name,
  comparators: {
    name: (a: Row, b: Row) => a.name.localeCompare(b.name),
    qty: (a: Row, b: Row) => a.qty - b.qty,
  },
};

const params = (over: Partial<Parameters<typeof tableView<Row>>[1]>): Parameters<typeof tableView<Row>>[1] => ({
  q: "",
  sort: "name",
  dir: "asc",
  offset: 0,
  pageSize: 25,
  ...over,
});

describe("tableView", () => {
  it("sorts by a string key ascending and descending", () => {
    expect(tableView(rows, params({ sort: "name", dir: "asc" }), opts).rows.map((r) => r.name)).toEqual([
      "Acme",
      "Beta",
      "Gamma",
    ]);
    expect(tableView(rows, params({ sort: "name", dir: "desc" }), opts).rows.map((r) => r.name)).toEqual([
      "Gamma",
      "Beta",
      "Acme",
    ]);
  });

  it("sorts numerically by a numeric key", () => {
    expect(tableView(rows, params({ sort: "qty", dir: "desc" }), opts).rows.map((r) => r.qty)).toEqual([3, 2, 1]);
  });

  it("filters by the search accessor (case-insensitive) and reports the filtered total", () => {
    const out = tableView(rows, params({ q: "am" }), opts); // matches "Gamma"
    expect(out.total).toBe(1);
    expect(out.rows.map((r) => r.name)).toEqual(["Gamma"]);
  });

  it("paginates while total stays the full filtered count", () => {
    const out = tableView(rows, params({ sort: "name", dir: "asc", offset: 1, pageSize: 1 }), opts);
    expect(out.total).toBe(3);
    expect(out.rows.map((r) => r.name)).toEqual(["Beta"]);
  });

  it("falls back to the first comparator for an unknown sort key", () => {
    expect(tableView(rows, params({ sort: "nope", dir: "asc" }), opts).rows.map((r) => r.name)).toEqual([
      "Acme",
      "Beta",
      "Gamma",
    ]);
  });
});
