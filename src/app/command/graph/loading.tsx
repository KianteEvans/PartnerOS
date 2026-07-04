import type { ReactNode } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { HeaderSkeleton, TabsSkeleton, HeroSkeleton } from "@/components/ui/Skeleton";

export default function Loading(): ReactNode {
  return (
    <PageShell>
      <HeaderSkeleton />
      <TabsSkeleton tabs={3} />
      <HeroSkeleton />
    </PageShell>
  );
}
