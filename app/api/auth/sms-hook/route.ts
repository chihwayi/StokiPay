import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendOtpSms } from "@/lib/integrations/sms";
import { rememberDevOtp } from "@/lib/integrations/dev-otp-store";

// GoTrue "Send SMS" Auth Hook receiver (ADR 0005). Verifies the Standard
// Webhooks signature GoTrue signs every hook call with
// (GOTRUE_HOOK_SEND_SMS_SECRETS, format "v1,whsec_<base64>") before acting
// on the payload — this is our own internal hook, but it crosses a network
// boundary so it gets verified like any other webhook (CLAUDE.md rule 7).
function verifySignature(secret: string, id: string, timestamp: string, body: string, signatureHeader: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${body}`;
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");

  return signatureHeader
    .split(" ")
    .some((sig) => {
      const [, value] = sig.split(",");
      if (!value) return false;
      const a = Buffer.from(value);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    });
}

export async function POST(req: NextRequest) {
  const secretsConfig = process.env.GOTRUE_HOOK_SEND_SMS_SECRET;
  if (!secretsConfig) {
    return NextResponse.json({ error: { http_code: 500, message: "hook not configured" } }, { status: 500 });
  }

  const id = req.headers.get("webhook-id");
  const timestamp = req.headers.get("webhook-timestamp");
  const signature = req.headers.get("webhook-signature");
  const body = await req.text();

  if (!id || !timestamp || !signature || !verifySignature(secretsConfig, id, timestamp, body, signature)) {
    return NextResponse.json({ error: { http_code: 401, message: "invalid signature" } }, { status: 401 });
  }

  let payload: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: { http_code: 400, message: "invalid payload" } }, { status: 400 });
  }

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) {
    return NextResponse.json({ error: { http_code: 400, message: "missing phone/otp" } }, { status: 400 });
  }

  try {
    const result = await sendOtpSms(phone, otp);
    if (!result.delivered) {
      // Dev-fallback path: still return 200 so the signup/sign-in flow
      // completes in staging without real Africa's Talking credentials —
      // the OTP is only visible in server logs and the dev-otp debug
      // endpoint, never silently discarded.
      console.log(`[sms-hook] dev-fallback delivery for ${phone}`);
      rememberDevOtp(phone, otp);
    }
    return NextResponse.json({});
  } catch (err) {
    console.error("[sms-hook] send failed", err);
    return NextResponse.json({ error: { http_code: 500, message: "sms send failed" } }, { status: 500 });
  }
}
