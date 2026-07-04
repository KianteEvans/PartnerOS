import type { ReactNode } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { HeaderSkeleton, HeroSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function Loading(): ReactNode {
  return (
    <PageShell>
      <HeaderSkeleton />
      <HeroSkeleton />
      <TableSkeleton rows={6} />
    </PageShell>
  );
}
