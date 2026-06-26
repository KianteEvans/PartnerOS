import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Best-effort cleanup of embedded-postgres child processes that linger after the
 * suite. On Windows, EmbeddedPostgres.stop() returns before the forked postgres
 * children are reaped, leaving session-1 (console) postgres.exe processes behind.
 * A developer's "real" Postgres runs as a Windows service in session 0, so we
 * only target non-service instances. No-op on other platforms.
 */
export async function teardown(): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    // List console-session postgres.exe (SessionId != 0) and kill their trees.
    const ps =
      "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | " +
      "Where-Object { $_.SessionId -ne 0 } | " +
      "ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }";
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { windowsHide: true },
    );
  } catch {
    // Cleanup is best-effort; never fail the test run because of it.
  }
}
