import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/auth/session";

export async function POST(req: Request): Promise<NextResponse> {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
