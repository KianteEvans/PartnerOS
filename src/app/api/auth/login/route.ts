import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getOidcProvider } from "@/auth/oidc";
import { env } from "@/env";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 600,
  secure: !env.IS_LOCAL_DEV,
};

export async function GET(): Promise<NextResponse> {
  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");

  const jar = await cookies();
  jar.set("oidc_state", state, COOKIE_OPTS);
  jar.set("oidc_nonce", nonce, COOKIE_OPTS);

  const url = await getOidcProvider().authorizationUrl({ state, nonce });
  return NextResponse.redirect(url);
}
