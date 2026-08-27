import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/auth/supabase-admin";
import { createClient } from "@/lib/auth/supabase-server";

// TEMPORARY BRIDGE — NOT PHONE-VERIFIED. Do not use with real users.
//
// GoTrue's phone OTP flow is fully built (app/sign-in originally called
// supabase.auth.signInWithOtp, app/api/auth/sms-hook implements the real
// Send SMS Hook per ADR 0005) but is currently blocked on a reproducible
// GoTrue-side error ("500: Hook requires authorization token") when it
// tries to invoke our hook, despite a correctly-parsed
// GOTRUE_HOOK_SEND_SMS_SECRETS (confirmed: an incorrectly-formatted
// secret crashes GoTrue at startup with "invalid secret format" instead —
// this is a different, later failure whose exact cause is still
// unresolved). Tracked as a known limitation in
// docs/handoffs/sprint-1.md rather than silently worked around.
//
// This route exists only so the rest of the stack (onboarding RPC,
// dashboard, RLS, device registration) is clickable end-to-end in
// staging right now. It creates/logs in a GoTrue user for the given
// phone number with NO proof of phone ownership whatsoever — anyone who
// knows a phone number can claim it. Delete this route and switch
// app/sign-in back to signInWithOtp/verifyOtp the moment the hook issue
// above is fixed.
export async function POST(req: NextRequest) {
  const { phone } = await req.json();
  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const password = randomBytes(24).toString("base64url");

  const { data: existing } = await admin.auth.admin.listUsers();
  const existingUser = existing?.users.find((u) => u.phone === phone.replace(/^\+/, ""));

  if (existingUser) {
    const { error: updateError } = await admin.auth.admin.updateUserById(existingUser.id, { password });
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  } else {
    const { error: createError } = await admin.auth.admin.createUser({
      phone,
      password,
      phone_confirm: true,
    });
    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }
  }

  const tokenResponse = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone, password }),
    },
  );

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    return NextResponse.json({ error: `sign-in failed: ${body}` }, { status: 500 });
  }

  const { access_token, refresh_token } = await tokenResponse.json();
  const supabase = await createClient();
  const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
