/**
 * Moved to `@/domain/list-view` (now shared app-wide, not just Marketplace). Re-exported here
 * so the existing Marketplace imports keep working unchanged. New consumers should import from
 * `@/domain/list-view` directly.
 */
export { tableView, type TableViewResult, type TableViewOptions } from "@/domain/list-view";
