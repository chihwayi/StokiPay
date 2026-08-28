import { describe, expect, it } from "vitest";
import { computeCashVariance, formatMoney, toMinorUnits } from "@/lib/domain/money";

describe("money helpers (ADR 0004)", () => {
  it("formats positive minor units with the currency code", () => {
    expect(formatMoney(1100, "USD")).toBe("USD 11.00");
  });

  it("formats negative minor units with a leading sign", () => {
    expect(formatMoney(-250, "USD")).toBe("-USD 2.50");
  });

  it("converts a decimal amount to minor units", () => {
    expect(toMinorUnits(11.5)).toBe(1150);
  });
});

describe("cash-up variance (sprints.md Sprint 3)", () => {
  it("reports zero variance and no review when counted matches expected", () => {
    const { varianceMinor, requiresReview } = computeCashVariance(5200, 5200, 200);
    expect(varianceMinor).toBe(0);
    expect(requiresReview).toBe(false);
  });

  it("does not require review when within threshold", () => {
    const { varianceMinor, requiresReview } = computeCashVariance(5150, 5200, 200);
    expect(varianceMinor).toBe(-50);
    expect(requiresReview).toBe(false);
  });

  it("requires review when the variance exceeds the threshold, over or short", () => {
    expect(computeCashVariance(5500, 5200, 200).requiresReview).toBe(true);
    expect(computeCashVariance(4900, 5200, 200).requiresReview).toBe(true);
  });

  it("treats the threshold boundary as not requiring review (strictly greater than)", () => {
    expect(computeCashVariance(5400, 5200, 200).requiresReview).toBe(false);
  });
});
