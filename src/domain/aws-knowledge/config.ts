/**
 * Configuration for the "Ask AWS" assistant — a doc-grounded Q&A helper backed by
 * the Anthropic Messages API's MCP connector pointed at AWS's hosted, public AWS
 * Knowledge MCP server (https://knowledge-mcp.global.api.aws). No auth token: the
 * server is unauthenticated. Tools exposed: search_documentation, read_documentation,
 * recommend, list_regions, get_regional_availability, retrieve_skill.
 */

export const AWS_KNOWLEDGE_MCP_URL = "https://knowledge-mcp.global.api.aws";

/** Messages API MCP-connector beta (the 2025-04-04 header is deprecated). */
export const AWS_KNOWLEDGE_MCP_BETA = "mcp-client-2025-11-20";

export const AWS_KNOWLEDGE_SYSTEM_PROMPT = `You are an AWS Partner Network specialist embedded in PartnerOS, an operating system for AWS partners. Answer the user's question about AWS partner programs — Competencies, Partner tiers/paths, MDF (Marketing Development Funds), ACE / co-sell, the Foundational Technical Review, Well-Architected, and related requirements.

Ground every program-specific claim in official AWS documentation. Use the aws-knowledge tools (search_documentation, then read_documentation on the most relevant page) to look up the current requirement BEFORE answering — do not answer program specifics from memory, because these requirements change. Prefer reading the specific doc page over guessing.

Lead with the direct answer, then the key requirements as a short bulleted list. Keep it concise and practical for a partner-operations audience. If the documentation does not cover the question, say so plainly rather than inventing details. Never fabricate URLs.`;

/**
 * AWS Knowledge MCP tools — all read-only. We allowlist them explicitly so the
 * assistant can never invoke a write/destructive tool, even if AWS adds one later
 * (per the MCP-connector docs' allowlist guidance for read-only assistants).
 */
export const AWS_KNOWLEDGE_READ_TOOLS = [
  "search_documentation",
  "read_documentation",
  "recommend",
  "list_regions",
  "get_regional_availability",
  "retrieve_skill",
] as const;

export interface McpToolset {
  readonly type: "mcp_toolset";
  readonly mcp_server_name: string;
  readonly default_config: { readonly enabled: false };
  readonly configs: Record<string, { readonly enabled: true }>;
}

/**
 * Deny-by-default MCP toolset that enables ONLY the read-only AWS Knowledge tools.
 * NOTE: the MCP connector is not eligible for Zero-Data-Retention — the question +
 * tool results are retained under Anthropic's standard data-retention policy.
 */
export function readOnlyToolset(serverName: string): McpToolset {
  const configs: Record<string, { readonly enabled: true }> = {};
  for (const tool of AWS_KNOWLEDGE_READ_TOOLS) configs[tool] = { enabled: true };
  return {
    type: "mcp_toolset",
    mcp_server_name: serverName,
    default_config: { enabled: false },
    configs,
  };
}
