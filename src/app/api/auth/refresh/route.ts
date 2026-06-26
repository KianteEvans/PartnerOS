import { NextResponse } from "next/server";
import { getServerIdentity, signSession, setSessionCookie } from "@/auth/session";

/**
 * Slide the idle window: re-mint the session with a fresh `seen` so an active
 * user stays signed in. The client SessionKeepalive POSTs here periodically while
 * the user is active. getServerIdentity enforces active + not-revoked + not-idle,
 * so an already-expired session can't refresh itself — it gets a 401 and the
 * client redirects to sign in.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const id = await getServerIdentity();
    const token = await signSession({
      tid: id.tenantId,
      uid: id.userId,
      sub: id.oidcSubject,
      email: id.email,
      role: id.role,
      epoch: id.epoch,
    });
    await setSessionCookie(token);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
