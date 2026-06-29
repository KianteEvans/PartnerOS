import { withSystem } from "@/db/client";
import { demoRequests } from "@/db/schema";
import type { DemoRequestInput } from "@/domain/demo/schemas";

/**
 * Persist a public "Book a demo" lead. There is no session here (the visitor is
 * unauthenticated), and the row belongs to no tenant, so this uses the privileged
 * RLS-bypassing path — the same one provisioning uses before identity exists
 * (Rule 5). It only ever touches the tenant-free `demo_requests` table.
 */
export async function createDemoRequestOp(input: DemoRequestInput): Promise<{ id: string }> {
  return withSystem(async (tx) => {
    const [row] = await tx
      .insert(demoRequests)
      .values({
        name: input.name,
        email: input.email,
        company: input.company,
        teamSize: input.teamSize,
        message: input.message,
      })
      .returning({ id: demoRequests.id });
    return { id: row!.id };
  });
}
