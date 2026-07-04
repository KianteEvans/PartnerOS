import type { ReactNode } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { HeaderSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function Loading(): ReactNode {
  return (
    <PageShell>
      <HeaderSkeleton />
      <TableSkeleton rows={5} />
      <TableSkeleton rows={4} />
    </PageShell>
  );
}
