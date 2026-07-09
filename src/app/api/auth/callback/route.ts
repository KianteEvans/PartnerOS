import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getOidcProvider } from "@/auth/oidc";
import { resolveOrProvisionUser } from "@/auth/provision";
import { signSession, setSessionCookie } from "@/auth/session";
import { AppError } from "@/http/errors";
import { log } from "@/observability/logger";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const expectedState = jar.get("oidc_state")?.value;
  const nonce = jar.get("oidc_nonce")?.value;

  if (
    !code ||
    !state ||
    !expectedState ||
    !nonce ||
    state !== expectedState
  ) {
    return new NextResponse("Invalid OIDC callback", { status: 400 });
  }

  try {
    const claims = await getOidcProvider().exchangeCode({ code, nonce });
    const session = await resolveOrProvisionUser(claims);
    const token = await signSession(session);
    await setSessionCookie(token);
    jar.delete("oidc_state");
    jar.delete("oidc_nonce");
    return NextResponse.redirect(new URL("/", req.url));
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    const message =
      err instanceof AppError && err.expose ? err.message : "Login failed";
    // A 500 here is a real bug (not a rejected login); surface it server-side
    // instead of swallowing it behind the generic message.
    if (status >= 500) {
      log.error("auth.callback_failure", {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? (err.stack ?? null) : null,
      });
    }
    return new NextResponse(message, { status });
  }
}
