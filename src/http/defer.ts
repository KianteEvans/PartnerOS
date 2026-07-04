import { after } from "next/server";

/**
 * Run best-effort work AFTER the response has streamed (next's `after()`), so
 * materialize-on-read writes — daily snapshot captures, playbook automation —
 * stop taxing the critical path. Outside a request scope (integration tests,
 * scripts) `after()` throws; we then run the task inline to preserve the
 * original materialize-on-read semantics. Never throws either way: this work
 * must never break a page.
 */
export async function deferAfterResponse(task: () => Promise<void>): Promise<void> {
  try {
    after(() => task().catch(() => undefined));
  } catch {
    await task().catch(() => undefined);
  }
}
