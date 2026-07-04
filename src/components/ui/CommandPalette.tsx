"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  IconCommand,
  IconAssessments,
  IconRoadmaps,
  IconPrograms,
  IconTiers,
  IconAce,
  IconMdf,
  IconApplications,
  IconEvidence,
  IconCaseStudies,
  IconReports,
  IconTasks,
  IconSettings,
  IconOnboarding,
  type IconProps,
} from "@/components/ui/icons";

/** Other client components dispatch this to open the palette (e.g. the TopBar). */
export const OPEN_PALETTE_EVENT = "partneros:open-palette";

interface Command {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly group: "Go to" | "Create";
  readonly keywords?: string;
  readonly Icon?: (p: IconProps) => ReactNode;
}

const COMMANDS: ReadonlyArray<Command> = [
  { id: "command", label: "Command Center", href: "/command", group: "Go to", keywords: "dashboard home health brief", Icon: IconCommand },
  { id: "assessments", label: "Assessments", href: "/plan", group: "Go to", keywords: "readiness score", Icon: IconAssessments },
  { id: "roadmaps", label: "Roadmaps", href: "/plan/roadmaps", group: "Go to", keywords: "plan milestones", Icon: IconRoadmaps },
  { id: "programs", label: "Program Management", href: "/programs", group: "Go to", keywords: "portfolio library gate competency", Icon: IconPrograms },
  { id: "applications", label: "Applications", href: "/programs/applications", group: "Go to", keywords: "competency self-assessment workbook submission specialization", Icon: IconApplications },
  { id: "tiers", label: "Tiers", href: "/programs/tiers", group: "Go to", keywords: "partner tier select advanced premier", Icon: IconTiers },
  { id: "ace", label: "ACE Pipeline", href: "/ace", group: "Go to", keywords: "opportunities cosell relationships reps", Icon: IconAce },
  { id: "mdf", label: "MDF", href: "/mdf", group: "Go to", keywords: "marketing development funds reimbursement", Icon: IconMdf },
  { id: "evidence", label: "Evidence Locker", href: "/programs/evidence", group: "Go to", keywords: "documents files compliance", Icon: IconEvidence },
  { id: "case-studies", label: "Case Studies", href: "/programs/evidence/case-studies", group: "Go to", keywords: "customer references narratives proof evidence", Icon: IconCaseStudies },
  { id: "reports", label: "Reports", href: "/reports", group: "Go to", keywords: "export snapshot", Icon: IconReports },
  { id: "tasks", label: "Tasks", href: "/command/tasks", group: "Go to", keywords: "todo work", Icon: IconTasks },
  { id: "settings", label: "Settings", href: "/settings", group: "Go to", keywords: "workspace integrations users", Icon: IconSettings },
  { id: "onboarding", label: "Onboarding", href: "/onboarding", group: "Go to", keywords: "setup getting started welcome wizard resume", Icon: IconOnboarding },
  { id: "audit", label: "Audit log", href: "/settings/audit", group: "Go to", keywords: "security events activity who" },
  { id: "data-export", label: "Export workspace data", href: "/settings/data-export", group: "Go to", keywords: "dsar gdpr backup json download" },
  { id: "new-assessment", label: "New assessment", href: "/plan/new", group: "Create", keywords: "create readiness" },
  { id: "new-roadmap", label: "New roadmap", href: "/plan/roadmaps/new", group: "Create", keywords: "create plan" },
  { id: "new-mdf", label: "New MDF request", href: "/mdf", group: "Create", keywords: "request funds" },
  { id: "new-task", label: "New task", href: "/command/tasks", group: "Create", keywords: "create todo" },
  { id: "invite", label: "Invite a teammate", href: "/settings", group: "Create", keywords: "user member add" },
];

/**
 * Global ⌘K / Ctrl+K command palette. Mounted once in the authenticated shell.
 * Keyboard-driven: ↑/↓ to move, Enter to go, Esc to close; click also works.
 */
interface RecordResult {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly href: string;
}

interface Item {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly group: string;
  readonly Icon?: (p: IconProps) => ReactNode;
}

export function CommandPalette(): ReactNode {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [records, setRecords] = useState<ReadonlyArray<RecordResult>>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpen(): void {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setRecords([]);
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  // Debounced cross-table record search (sections/actions filter locally).
  useEffect(() => {
    if (!open) return undefined;
    const term = q.trim();
    if (term.length < 2) {
      setRecords([]);
      setLoading(false);
      return undefined;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d: { results?: RecordResult[] }) => setRecords(d.results ?? []))
        .catch(() => {
          /* aborted or failed — leave prior records */
        })
        .finally(() => setLoading(false));
    }, 160);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  if (!open) return null;

  const ql = q.trim().toLowerCase();
  const staticMatches: ReadonlyArray<Item> = ql
    ? COMMANDS.filter((c) => `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(ql))
    : COMMANDS;
  const recordItems: Item[] = records.map((r) => ({
    id: `rec:${r.type}:${r.id}`,
    label: r.label,
    href: r.href,
    group: r.type,
  }));
  const results: Item[] = [...staticMatches, ...recordItems];
  const active = Math.min(idx, Math.max(0, results.length - 1));

  // "You are here": the longest Go-to href that prefixes the current path, so
  // /programs/tiers marks Tiers (not Program Management) and /programs marks Programs.
  let currentId: string | null = null;
  let currentLen = -1;
  for (const c of COMMANDS) {
    if (c.group !== "Go to") continue;
    const onIt = c.href === "/" ? pathname === "/" : pathname === c.href || pathname.startsWith(c.href + "/");
    if (onIt && c.href.length > currentLen) {
      currentLen = c.href.length;
      currentId = c.id;
    }
  }

  function go(href: string): void {
    setOpen(false);
    router.push(href);
  }

  function onInputKey(e: ReactKeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) go(r.href);
    }
  }

  return (
    <div
      onMouseDown={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
        className="pos-palette"
        style={{
          width: "min(560px, 92vw)",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "var(--shadow-lift)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={onInputKey}
          placeholder="Search sections and actions…"
          aria-label="Search sections and actions"
          style={{
            width: "100%",
            border: "none",
            borderBottom: "1px solid var(--border)",
            background: "transparent",
            padding: "14px 16px",
            fontSize: 15,
            color: "var(--text)",
            outline: "none",
          }}
        />
        <ul style={{ listStyle: "none", margin: 0, padding: 6, maxHeight: "52vh", overflowY: "auto" }}>
          {results.length === 0 ? (
            <li style={{ padding: "14px 12px", color: "var(--muted)", fontSize: 13 }}>
              {loading ? "Searching…" : "No matches."}
            </li>
          ) : (
            results.map((c, i) => {
              const isCurrent = c.id === currentId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => go(c.href)}
                    aria-current={isCurrent ? "page" : undefined}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 12px",
                      borderRadius: 8,
                      border: "none",
                      borderLeft: isCurrent ? "2px solid var(--section-accent)" : "2px solid transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 14,
                      color: i === active ? "var(--accent)" : "var(--text)",
                      background: i === active ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
                    }}
                  >
                    <span style={{ width: 16, display: "inline-flex", color: i === active ? "var(--accent)" : "var(--muted)" }}>
                      {c.Icon ? <c.Icon size={16} /> : null}
                    </span>
                    <span style={{ flex: 1 }}>{c.label}</span>
                    <span style={{ fontSize: 11, fontWeight: isCurrent ? 600 : 400, color: isCurrent ? "var(--section-accent)" : "var(--muted)" }}>
                      {isCurrent ? "Current" : c.group}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
