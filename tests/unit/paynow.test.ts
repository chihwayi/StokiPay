import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computePaynowHash, mapPaynowStatus, verifyPaynowWebhook } from "@/lib/integrations/paynow";

// Synthetic payloads only — no real Paynow sandbox credentials were
// available this sprint (docs/handoffs/sprint-4.md). These prove our own
// implementation of Paynow's publicly documented hash scheme is
// internally consistent (a correctly-signed payload verifies, a tampered
// one doesn't) — they do not prove interoperability with the real Paynow
// service.

const INTEGRATION_KEY = "test-integration-key-1234";

function sign(fields: Record<string, string>): Record<string, string> {
  return { ...fields, hash: computePaynowHash(fields, INTEGRATION_KEY) };
}

describe("Paynow hash scheme (unverified against a live sandbox)", () => {
  it("computes a hash matching manual SHA-512 concatenation", () => {
    const fields = { reference: "sale-123", amount: "10.00", status: "Paid" };
    const expected = createHash("sha512")
      .update("sale-12310.00Paid" + INTEGRATION_KEY)
      .digest("hex")
      .toUpperCase();
    expect(computePaynowHash(fields, INTEGRATION_KEY)).toBe(expected);
  });

  it("verifies a correctly-signed payload", () => {
    const signed = sign({ reference: "sale-123", amount: "10.00", status: "Paid" });
    expect(verifyPaynowWebhook(signed, INTEGRATION_KEY)).toBe(true);
  });

  it("rejects a payload with a tampered field after signing", () => {
    const signed = sign({ reference: "sale-123", amount: "10.00", status: "Paid" });
    signed.amount = "999.00";
    expect(verifyPaynowWebhook(signed, INTEGRATION_KEY)).toBe(false);
  });

  it("rejects a payload signed with the wrong key", () => {
    const signed = { ...sign({ reference: "sale-123", amount: "10.00", status: "Paid" }) };
    expect(verifyPaynowWebhook(signed, "a-completely-different-key")).toBe(false);
  });

  it("rejects a payload with no hash field at all", () => {
    expect(verifyPaynowWebhook({ reference: "sale-123", amount: "10.00" }, INTEGRATION_KEY)).toBe(false);
  });
});

describe("Paynow status mapping", () => {
  it("maps Paid to confirmed", () => {
    expect(mapPaynowStatus("Paid")).toBe("confirmed");
  });

  it("maps Cancelled to cancelled", () => {
    expect(mapPaynowStatus("Cancelled")).toBe("cancelled");
  });

  it("maps Disputed/Refunded to failed", () => {
    expect(mapPaynowStatus("Disputed")).toBe("failed");
    expect(mapPaynowStatus("Refunded")).toBe("failed");
  });

  it("returns null (no transition) for a non-terminal status", () => {
    expect(mapPaynowStatus("Created")).toBeNull();
    expect(mapPaynowStatus("Sent")).toBeNull();
  });
});
