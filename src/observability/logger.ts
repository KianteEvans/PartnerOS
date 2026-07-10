import { env } from "@/env";

/**
 * Minimal structured logging for production. Emits one JSON object per line to
 * stdout/stderr so any collector (CloudWatch Logs, the Docker log driver, etc.)
 * can ingest it without agent configuration. Error-level events are optionally
 * forwarded to ERROR_REPORT_URL -- a generic webhook, same pattern as
 * EMAIL_DELIVERY_URL -- so a Sentry-style collector can be attached without an
 * SDK dependency. Reporting is fire-and-forget: it can never affect the
 * request path.
 */

type Level = "info" | "warn" | "error";

export interface LogFields {
  readonly [key: string]: unknown;
}

function emit(level: Level, event: string, fields: LogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

async function report(event: string, fields: LogFields): Promise<void> {
  const url = env.ERROR_REPORT_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "partneros", event, ...fields }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Never let error reporting break the caller.
  }
}

export const log = {
  info(event: string, fields: LogFields = {}): void {
    emit("info", event, fields);
  },
  warn(event: string, fields: LogFields = {}): void {
    emit("warn", event, fields);
  },
  error(event: string, fields: LogFields = {}): void {
    emit("error", event, fields);
    void report(event, fields);
  },
};
