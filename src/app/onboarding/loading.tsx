import type { ReactNode } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { HeaderSkeleton, TabsSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function Loading(): ReactNode {
  return (
    <PageShell width={720}>
      <HeaderSkeleton />
      <TabsSkeleton tabs={4} />
      <TableSkeleton rows={4} />
    </PageShell>
  );
}
