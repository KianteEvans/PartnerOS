import { NextResponse } from "next/server";
import { loadSamlTenant, buildSaml } from "@/domain/saml/sp";

/** SP-initiated SAML login: redirect to the tenant's IdP with a fresh AuthnRequest. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const cfg = await loadSamlTenant(slug);
  if (!cfg) return NextResponse.json({ error: "SAML is not configured for this workspace" }, { status: 404 });

  try {
    const saml = buildSaml(cfg, new URL(req.url).origin);
    const url = await saml.getAuthorizeUrlAsync("/", undefined, {});
    return NextResponse.redirect(url, { status: 302 });
  } catch {
    return NextResponse.json({ error: "Could not build the SAML request" }, { status: 500 });
  }
}
