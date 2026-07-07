import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Callout } from "@/components/ui/Callout";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { CommandNav } from "@/app/command/CommandNav";
import { loadCommandData } from "@/domain/command/load";
import { buildCausalGraph } from "@/domain/graph/causal";
import { buildAttributionGraph } from "@/domain/graph/attribution";
import { loadAttributionExtra } from "@/domain/graph/graph-load";
import { layoutGraph } from "@/domain/graph/layout";
import { PartnershipGraph } from "@/app/command/graph/PartnershipGraph";
import type { PartnershipGraph as GraphModel } from "@/domain/graph/types";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";

/**
 * The Partnership Map — the capstone cross-domain surface. Two views on one graph:
 *  - Causal: why partnership health is what it is (root ← 6 weighted drivers ← the specific
 *    risks dragging each, each carrying its impact-if-fixed).
 *  - Attribution: how work in one domain flows into outcomes in another (the counted FK chains).
 * Builders are pure + unit-tested; this page loads, builds, lays out, and hands a plain-JSON
 * positioned graph to the interactive client island. Reuses command:read (auth guard only).
 */
export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("command_graph");
  if (fenced) return <PackageFence feature="command_graph" previewTier={fenced} />;

  const { view: viewParam } = await searchParams;
  const view: "causal" | "attribution" = viewParam === "attribution" ? "attribution" : "causal";
  const today = new Date().toISOString().slice(0, 10);

  const data = await loadCommandData(identity);

  let model: GraphModel;
  if (view === "attribution") {
    const extra = await loadAttributionExtra(identity);
    model = buildAttributionGraph(data.inputs, extra, today);
  } else {
    model = buildCausalGraph(data.inputs, today);
  }
  const positioned = layoutGraph(model);
  const causalClear = model.kind === "causal" && !model.nodes.some((n) => n.kind === "cause");

  return (
    <PageShell>
      <PageHeader
        title="Partnership Map"
        breadcrumbs={[{ href: "/", label: "Home" }, { href: "/command", label: "Command Center" }, { label: "Map" }]}
        subtitle={
          view === "attribution"
            ? "How work in one domain flows into outcomes in another — the cross-domain chains ACE can't assemble."
            : "Why your partnership health is what it is — the drivers, and the specific fixes that move it most."
        }
        actions={
          <SegmentedControl
            options={[
              { value: "causal", label: "Causal" },
              { value: "attribution", label: "Attribution" },
            ]}
            value={view}
            hrefFor={(v) => `/command/graph?view=${v}`}
          />
        }
      />
      <CommandNav />

      {view === "causal" && (
        <Callout tone="info" title="Reading this map">
          Partnership health (right) is a weighted blend of six drivers (middle). Each cause on the left drags
          a driver; the ▲ badge is the exact health gain if you resolve it — the same numbers as the
          &ldquo;Your move&rdquo; panel.
        </Callout>
      )}

      {causalClear && (
        <Callout tone="ok" title="No active risks">
          Every health driver is clear right now — there are no dragging causes to resolve. Switch to the
          Attribution view to see where your partnership value flows.
        </Callout>
      )}

      <Panel title={view === "attribution" ? "Attribution flow" : "Causal map"} accent="var(--section-accent)">
        <PartnershipGraph graph={positioned} />
      </Panel>
    </PageShell>
  );
}
