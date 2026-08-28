import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/auth/supabase-admin";
import { mapPaynowStatus, verifyPaynowWebhook, type PaynowWebhookFields } from "@/lib/integrations/paynow";

// Paynow's "Result URL" webhook receiver (sprints.md Sprint 4). Every
// inbound call is logged to provider_webhook_log regardless of validity
// — an invalid signature is rejected AND audited, not just silently
// dropped (sprints.md acceptance criterion). A duplicate/replayed
// webhook for an already-terminal provider_payments row is a no-op
// (enforced inside stockflow_reconcile_provider_payment,
// lib/db/migrations/0015...), not a second reconciled payment.
//
// Not verified against a real Paynow sandbox this sprint — see
// lib/integrations/paynow.ts's file header and docs/handoffs/sprint-4.md.
export async function POST(req: NextRequest) {
  const integrationKey = process.env.PAYNOW_INTEGRATION_KEY;
  const rawBody = await req.text();
  const parsed = new URLSearchParams(rawBody);
  const fields: PaynowWebhookFields = {};
  for (const [key, value] of parsed.entries()) fields[key] = value;

  const admin = createAdminClient();

  if (!integrationKey) {
    await admin.from("provider_webhook_log").insert({
      provider: "paynow",
      signature_valid: false,
      raw_body: rawBody,
    });
    return NextResponse.json({ error: "Paynow integration is not configured" }, { status: 500 });
  }

  const reference = fields.reference;
  const { data: providerPayment } = reference
    ? await admin
        .from("provider_payments")
        .select("id, tenant_id")
        .eq("provider_reference", reference)
        .eq("provider", "paynow")
        .maybeSingle()
    : { data: null };

  const signatureValid = verifyPaynowWebhook(fields, integrationKey);

  await admin.from("provider_webhook_log").insert({
    provider_payment_id: providerPayment?.id ?? null,
    provider: "paynow",
    signature_valid: signatureValid,
    raw_body: rawBody,
  });

  if (!signatureValid) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  if (!providerPayment) {
    // Signature is valid but we don't recognise the reference — log it
    // (already done above) and acknowledge without acting, rather than
    // erroring in a way Paynow might interpret as "retry forever".
    return NextResponse.json({ ok: true, note: "unknown reference" });
  }

  await admin
    .from("provider_payments")
    .update({ last_webhook_at: new Date().toISOString() })
    .eq("id", providerPayment.id);

  const newStatus = mapPaynowStatus(fields.status ?? "");
  if (!newStatus) {
    return NextResponse.json({ ok: true, note: "non-terminal status, no transition" });
  }

  const { error } = await admin.rpc("stockflow_reconcile_provider_payment", {
    p_provider_payment_id: providerPayment.id,
    p_new_status: newStatus,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
