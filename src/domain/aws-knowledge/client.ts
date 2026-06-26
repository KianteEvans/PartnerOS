import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import {
  AWS_KNOWLEDGE_MCP_URL,
  AWS_KNOWLEDGE_MCP_BETA,
  AWS_KNOWLEDGE_SYSTEM_PROMPT,
  readOnlyToolset,
} from "@/domain/aws-knowledge/config";
import { parseAwsAnswer, type AwsBlock, type AwsAnswer } from "@/domain/aws-knowledge/parse";

/**
 * Server-only client for the "Ask AWS" assistant. Calls the Anthropic Messages API
 * with the remote MCP connector pointed at AWS Knowledge; Claude runs the doc-search
 * tools server-side and returns a grounded answer with the source pages inline. Only
 * ever imported by the server action — never reaches the client bundle.
 */

export function isAwsKnowledgeEnabled(): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
}

export async function askAwsKnowledge(question: string): Promise<AwsAnswer> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("The AWS Knowledge assistant is not configured");

  const client = new Anthropic({ apiKey });
  const message = await client.beta.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    system: AWS_KNOWLEDGE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: question }],
    mcp_servers: [{ type: "url", url: AWS_KNOWLEDGE_MCP_URL, name: "aws-knowledge" }],
    tools: [readOnlyToolset("aws-knowledge")],
    betas: [AWS_KNOWLEDGE_MCP_BETA],
  });

  // The MCP tool_use / tool_result blocks are typed loosely across SDK versions;
  // our pure parser owns the shape it needs.
  return parseAwsAnswer(message.content as unknown as AwsBlock[]);
}
