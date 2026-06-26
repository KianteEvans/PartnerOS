import { describe, it, expect } from "vitest";
import {
  extractAnswer,
  extractCitations,
  countToolCalls,
  parseAwsAnswer,
  type AwsBlock,
} from "@/domain/aws-knowledge/parse";

const SAMPLE: AwsBlock[] = [
  { type: "mcp_tool_use", name: "search_documentation", server_name: "aws-knowledge", input: { query: "migration competency" } },
  {
    type: "mcp_tool_result",
    content: [
      { type: "text", text: "See https://docs.aws.amazon.com/partner/migration-competency.html and https://aws.amazon.com/partners/ for details." },
    ],
  },
  { type: "mcp_tool_use", name: "read_documentation", server_name: "aws-knowledge", input: { url: "https://docs.aws.amazon.com/partner/migration-competency.html" } },
  { type: "text", text: "The Migration Competency requires:" },
  { type: "text", text: "- Two public case studies\n- A technical validation" },
];

describe("extractAnswer", () => {
  it("joins all text blocks in order, trimmed", () => {
    expect(extractAnswer(SAMPLE)).toBe(
      "The Migration Competency requires:\n- Two public case studies\n- A technical validation",
    );
  });
  it("is empty when there are no text blocks", () => {
    expect(extractAnswer([{ type: "mcp_tool_use", input: {} }])).toBe("");
  });
});

describe("extractCitations", () => {
  it("collects AWS doc URLs from tool inputs and result bodies, deduped", () => {
    const urls = extractCitations(SAMPLE).map((c) => c.url);
    // The read_documentation input URL appears in both the result text and the
    // tool input — it must be deduped to a single citation.
    expect(urls).toContain("https://docs.aws.amazon.com/partner/migration-competency.html");
    expect(urls).toContain("https://aws.amazon.com/partners/");
    expect(urls.filter((u) => u.includes("migration-competency")).length).toBe(1);
  });
  it("ignores non-AWS URLs and trailing punctuation", () => {
    const urls = extractCitations([
      { type: "mcp_tool_result", content: [{ type: "text", text: "Unrelated https://example.com/x, and https://docs.aws.amazon.com/foo.html." }] },
    ]).map((c) => c.url);
    expect(urls).toEqual(["https://docs.aws.amazon.com/foo.html"]);
  });
  it("caps the number of citations", () => {
    const many: AwsBlock[] = [
      {
        type: "mcp_tool_result",
        content: [{ type: "text", text: Array.from({ length: 20 }, (_, i) => `https://docs.aws.amazon.com/p${i}.html`).join(" ") }],
      },
    ];
    expect(extractCitations(many, 8).length).toBe(8);
  });
});

describe("countToolCalls / parseAwsAnswer", () => {
  it("counts mcp_tool_use blocks", () => {
    expect(countToolCalls(SAMPLE)).toBe(2);
  });
  it("assembles the full answer object", () => {
    const out = parseAwsAnswer(SAMPLE);
    expect(out.toolCalls).toBe(2);
    expect(out.citations.length).toBeGreaterThan(0);
    expect(out.answer.startsWith("The Migration Competency")).toBe(true);
  });
});
