import type { ReactNode } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { HeaderSkeleton, HeroSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function Loading(): ReactNode {
  return (
    <PageShell width={920}>
      <HeaderSkeleton />
      <HeroSkeleton />
      <TableSkeleton rows={4} />
      <TableSkeleton rows={3} />
    </PageShell>
  );
}
