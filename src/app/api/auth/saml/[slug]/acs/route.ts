import { NextResponse } from "next/server";
import { withSystem } from "@/db/client";
import { provisionSamlWithinTx } from "@/auth/provision";
import { signSession, setSessionCookie } from "@/auth/session";
import { loadSamlTenant, buildSaml, samlEmail } from "@/domain/saml/sp";

/**
 * Assertion Consumer Service. The IdP POSTs a signed SAMLResponse here; node-saml
 * (xml-crypto) validates its signature against the tenant's configured cert and
 * checks the audience + timestamps. On success we provision/look up the user
 * WITHIN THIS TENANT and mint our own session. Any failure redirects to sign-in
 * with an error — never leak validation detail.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const home = new URL("/", req.url);
  const fail = (code: string): NextResponse =>
    NextResponse.redirect(new URL(`/?error=${code}`, req.url), { status: 303 });

  const cfg = await loadSamlTenant(slug);
  if (!cfg) return fail("saml_unconfigured");

  let email: string | null = null;
  let nameID = "";
  try {
    const saml = buildSaml(cfg, new URL(req.url).origin);
    const form = await req.formData();
    const samlResponse = form.get("SAMLResponse");
    if (typeof samlResponse !== "string") return fail("saml_missing");

    const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
    if (!profile) return fail("saml_invalid");
    email = samlEmail(profile);
    nameID = profile.nameID;
  } catch {
    return fail("saml_invalid");
  }
  if (!email) return fail("saml_no_email");

  try {
    // NameID namespaced to the tenant so it can never collide across workspaces.
    const claims = await withSystem((tx) =>
      provisionSamlWithinTx(tx, cfg.tenantId, { sub: `saml:${cfg.tenantId}:${nameID}`, email: email! }),
    );
    await setSessionCookie(await signSession(claims));
    return NextResponse.redirect(home, { status: 303 });
  } catch {
    return fail("no_account");
  }
}
