import { describe, it, expect } from "vitest";
import { parseListParams, listHref, pageCount } from "@/domain/list";

const opts = { sortable: ["created", "amount"] as const, defaultSort: "created" };

describe("parseListParams", () => {
  it("applies defaults when params are absent", () => {
    const p = parseListParams({}, opts);
    expect(p).toMatchObject({ page: 1, pageSize: 25, offset: 0, sort: "created", dir: "desc", q: "" });
  });

  it("clamps the page to >= 1 and computes offset", () => {
    expect(parseListParams({ page: "0" }, opts).page).toBe(1);
    expect(parseListParams({ page: "-3" }, opts).page).toBe(1);
    expect(parseListParams({ page: "x" }, opts).page).toBe(1);
    expect(parseListParams({ page: "4" }, { ...opts, pageSize: 10 }).offset).toBe(30);
  });

  it("whitelists the sort key, falling back to the default", () => {
    expect(parseListParams({ sort: "amount" }, opts).sort).toBe("amount");
    expect(parseListParams({ sort: "evil; drop table" }, opts).sort).toBe("created");
  });

  it("only accepts asc/desc for direction", () => {
    expect(parseListParams({ dir: "asc" }, opts).dir).toBe("asc");
    expect(parseListParams({ dir: "DESC" }, opts).dir).toBe("desc"); // not lowercased -> default
    expect(parseListParams({ dir: "sideways" }, opts).dir).toBe("desc");
    expect(parseListParams({}, { ...opts, defaultDir: "asc" }).dir).toBe("asc");
  });

  it("trims the search term and takes the first of array params", () => {
    expect(parseListParams({ q: "  acme  " }, opts).q).toBe("acme");
    expect(parseListParams({ sort: ["amount", "created"] }, opts).sort).toBe("amount");
  });
});

describe("listHref", () => {
  it("drops empty/undefined params", () => {
    expect(listHref("/mdf", { q: "", sort: "amount", dir: undefined, page: 2 })).toBe("/mdf?sort=amount&page=2");
  });
  it("returns the bare base when nothing is set", () => {
    expect(listHref("/mdf", { q: "", page: undefined })).toBe("/mdf");
  });
});

describe("pageCount", () => {
  it("is at least 1 and rounds up", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
  });
});
