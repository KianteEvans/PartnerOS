import { NextResponse } from "next/server";
import { loadSamlTenant, buildSaml } from "@/domain/saml/sp";

/** SP metadata XML — hand this URL (or its contents) to the IdP admin to set up. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const cfg = await loadSamlTenant(slug);
  if (!cfg) return NextResponse.json({ error: "SAML is not configured for this workspace" }, { status: 404 });

  const saml = buildSaml(cfg, new URL(req.url).origin);
  const xml = saml.generateServiceProviderMetadata(null, null);
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
}
