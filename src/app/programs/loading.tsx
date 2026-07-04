import type { ReactNode } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { HeaderSkeleton, TabsSkeleton, HeroSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function Loading(): ReactNode {
  return (
    <PageShell>
      <HeaderSkeleton />
      <TabsSkeleton tabs={5} />
      <HeroSkeleton />
      <TableSkeleton rows={6} />
    </PageShell>
  );
}
