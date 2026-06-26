import { NextResponse } from "next/server";
import { applyScanWebhook } from "@/storage/malware-scan";
import { AppError } from "@/http/errors";

/**
 * Malware-scan webhook. Fail-closed: only a valid HMAC signature with a
 * well-formed payload flips an object's scan status. Anything else changes
 * nothing and the object stays inaccessible.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const raw = await req.text();
  const signature = req.headers.get("x-scan-signature");
  try {
    const ok = await applyScanWebhook(raw, signature);
    if (!ok) {
      return new NextResponse("Invalid signature", { status: 401 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return new NextResponse(
      err instanceof AppError ? err.message : "Scan webhook error",
      { status },
    );
  }
}
