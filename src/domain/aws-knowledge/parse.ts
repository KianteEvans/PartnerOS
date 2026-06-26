/**
 * Pure parsing of an Anthropic MCP-connector response into an answer + AWS doc
 * citations. Operates on a minimal block shape (NOT @anthropic-ai/sdk types) so it
 * is trivially unit-testable and immune to SDK version drift. The client casts the
 * SDK's response `content` to AwsBlock[] before handing it here.
 */

export interface AwsTextBlock {
  readonly type: "text";
  readonly text: string;
}
export interface AwsMcpToolUse {
  readonly type: "mcp_tool_use";
  readonly name?: string;
  readonly server_name?: string;
  readonly input?: unknown;
}
export interface AwsMcpToolResult {
  readonly type: "mcp_tool_result";
  readonly is_error?: boolean;
  readonly content?: unknown;
}
export type AwsBlock =
  | AwsTextBlock
  | AwsMcpToolUse
  | AwsMcpToolResult
  | { readonly type: string; readonly [k: string]: unknown };

export interface Citation {
  readonly url: string;
}
export interface AwsAnswer {
  readonly answer: string;
  readonly citations: readonly Citation[];
  readonly toolCalls: number;
}

const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/g;
const isAwsUrl = (u: string): boolean => /aws\.amazon\.com|amazonaws\.com|\.aws(\/|$)/.test(u);

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/** Concatenated assistant text across all text blocks, trimmed. */
export function extractAnswer(blocks: readonly AwsBlock[]): string {
  return blocks
    .filter(
      (b): b is AwsTextBlock => b.type === "text" && typeof (b as AwsTextBlock).text === "string",
    )
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const r = asRecord(c);
        return r && typeof r.text === "string" ? r.text : "";
      })
      .join("\n");
  }
  return "";
}

/**
 * AWS doc URLs the model actually consulted: the `url` passed to a doc-read tool,
 * plus any AWS URL found in a tool result body. Deduped, AWS-host-filtered, capped.
 */
export function extractCitations(blocks: readonly AwsBlock[], cap = 8): Citation[] {
  const urls = new Set<string>();
  const add = (u: string): void => {
    const trimmed = u.replace(/[.,);]+$/, "");
    if (isAwsUrl(trimmed)) urls.add(trimmed);
  };
  for (const b of blocks) {
    if (b.type === "mcp_tool_use") {
      const input = asRecord((b as AwsMcpToolUse).input);
      if (input && typeof input.url === "string") add(input.url);
    } else if (b.type === "mcp_tool_result") {
      const text = resultText((b as AwsMcpToolResult).content);
      for (const m of text.matchAll(URL_RE)) add(m[0]);
    }
  }
  return [...urls].slice(0, cap).map((url) => ({ url }));
}

export function countToolCalls(blocks: readonly AwsBlock[]): number {
  return blocks.filter((b) => b.type === "mcp_tool_use").length;
}

export function parseAwsAnswer(blocks: readonly AwsBlock[]): AwsAnswer {
  return {
    answer: extractAnswer(blocks),
    citations: extractCitations(blocks),
    toolCalls: countToolCalls(blocks),
  };
}
