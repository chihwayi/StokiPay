import { NextRequest, NextResponse } from "next/server";
import { readDevOtp } from "@/lib/integrations/dev-otp-store";

// Staging-only convenience so the phone OTP flow is clickable before real
// Africa's Talking sandbox credentials exist (ADR 0005). Inert the moment
// AFRICASTALKING_API_KEY is set — the dev-otp-store is never populated on
// that path, so this always returns null in production.
export function GET(req: NextRequest) {
  if (process.env.AFRICASTALKING_API_KEY) {
    return NextResponse.json({ otp: null });
  }
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) {
    return NextResponse.json({ error: "phone query param required" }, { status: 400 });
  }
  return NextResponse.json({ otp: readDevOtp(phone) });
}
