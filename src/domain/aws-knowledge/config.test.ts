import { describe, it, expect } from "vitest";
import { readOnlyToolset, AWS_KNOWLEDGE_READ_TOOLS } from "@/domain/aws-knowledge/config";

/**
 * The MCP-connector hardening: the toolset must deny by default and enable ONLY the
 * known read-only AWS Knowledge tools, so the assistant can never call a write tool.
 */
describe("readOnlyToolset", () => {
  it("denies by default and allowlists exactly the read-only AWS Knowledge tools", () => {
    const ts = readOnlyToolset("aws-knowledge");
    expect(ts.type).toBe("mcp_toolset");
    expect(ts.mcp_server_name).toBe("aws-knowledge");
    expect(ts.default_config.enabled).toBe(false);
    expect(Object.keys(ts.configs).sort()).toEqual([...AWS_KNOWLEDGE_READ_TOOLS].sort());
    for (const tool of AWS_KNOWLEDGE_READ_TOOLS) {
      expect(ts.configs[tool]?.enabled).toBe(true);
    }
  });
});
