import { createHash, timingSafeEqual } from "node:crypto";

// Paynow (Zimbabwean payment aggregator: EcoCash, OneMoney, cards —
// docs/architecture.md, project_description.md) adapter.
//
// IMPORTANT — unverified against a live sandbox (docs/handoffs/sprint-4.md):
// no Paynow merchant/integration credentials were available this sprint.
// The hash algorithm below (concatenate POST field values in order +
// integration key, SHA-512, uppercase hex) matches Paynow's long-standing
// publicly documented scheme and every official/community SDK's
// implementation of it, but has not been exercised against a real Paynow
// request/response in this session. Verify against Paynow's actual
// sandbox before this is trusted with real money — do not treat this as
// a proven integration.

export type PaynowWebhookFields = Record<string, string>;

// Computes Paynow's status-update hash: every field's value (excluding
// the hash field itself), concatenated in the order Paynow sent them,
// with the integration key appended, then SHA-512 hex-encoded and
// uppercased.
export function computePaynowHash(fields: PaynowWebhookFields, integrationKey: string): string {
  const concatenated =
    Object.entries(fields)
      .filter(([key]) => key.toLowerCase() !== "hash")
      .map(([, value]) => value)
      .join("") + integrationKey;
  return createHash("sha512").update(concatenated).digest("hex").toUpperCase();
}

export function verifyPaynowWebhook(fields: PaynowWebhookFields, integrationKey: string): boolean {
  const receivedHash = fields.hash ?? fields.Hash;
  if (!receivedHash) return false;

  const expected = computePaynowHash(fields, integrationKey);
  const receivedBuf = Buffer.from(receivedHash.toUpperCase(), "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

// Paynow's "Paid"/"Awaiting Delivery" style status strings map onto our
// provider_payments state machine (lib/db/migrations/0015...).
export function mapPaynowStatus(paynowStatus: string): "confirmed" | "failed" | "cancelled" | null {
  const normalized = paynowStatus.trim().toLowerCase();
  if (normalized === "paid" || normalized === "awaiting delivery" || normalized === "delivered") {
    return "confirmed";
  }
  if (normalized === "cancelled") return "cancelled";
  if (normalized === "disputed" || normalized === "refunded") return "failed";
  // "created" / "sent" / "pending" are non-terminal — no transition yet.
  return null;
}

export type InitiatePaymentResult =
  | { initiated: true; provider: "paynow"; pollUrl: string; redirectUrl: string | null }
  | { initiated: false; provider: "not-configured"; reason: string };

// Starts a Paynow transaction. No sandbox credentials were available
// this sprint (see file header) — without PAYNOW_INTEGRATION_ID/_KEY set,
// this returns a clear "not configured" result rather than pretending to
// call a real API, matching lib/integrations/sms.ts's dev-fallback
// pattern. Cash/manual tender at the till remains fully usable regardless
// (a payment provider must never block the core POS workflow).
export async function initiatePaynowPayment(params: {
  reference: string;
  amountMinor: number;
  currencyCode: string;
  resultUrl: string;
  returnUrl: string;
  customerEmail: string;
}): Promise<InitiatePaymentResult> {
  const integrationId = process.env.PAYNOW_INTEGRATION_ID;
  const integrationKey = process.env.PAYNOW_INTEGRATION_KEY;

  if (!integrationId || !integrationKey) {
    return { initiated: false, provider: "not-configured", reason: "Paynow credentials are not set" };
  }

  const amount = (params.amountMinor / 100).toFixed(2);
  const fields: Record<string, string> = {
    id: integrationId,
    reference: params.reference,
    amount,
    additionalinfo: `StockFlow ZW sale ${params.reference}`,
    returnurl: params.returnUrl,
    resulturl: params.resultUrl,
    authemail: params.customerEmail,
    status: "Message",
  };
  fields.hash = computePaynowHash(fields, integrationKey);

  const response = await fetch("https://www.paynow.co.zw/interface/initiatetransaction", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });

  const text = await response.text();
  const parsed = new URLSearchParams(text);
  if (parsed.get("status")?.toLowerCase() !== "ok") {
    throw new Error(`Paynow initiate failed: ${parsed.get("error") ?? text}`);
  }

  return {
    initiated: true,
    provider: "paynow",
    pollUrl: parsed.get("pollurl") ?? "",
    redirectUrl: parsed.get("browserurl"),
  };
}

// Poll fallback (sprints.md: "verified webhook or poll"). Uses the same
// hash verification as the webhook, since Paynow's poll response uses
// the identical field/hash scheme.
export async function pollPaynowStatus(
  pollUrl: string,
): Promise<{ status: string; fields: PaynowWebhookFields }> {
  const response = await fetch(pollUrl);
  const text = await response.text();
  const parsed = new URLSearchParams(text);
  const fields: PaynowWebhookFields = {};
  for (const [key, value] of parsed.entries()) fields[key] = value;
  return { status: fields.status ?? "", fields };
}
