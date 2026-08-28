// Pure money helpers (docs/architecture.md's lib/domain/ contract — no
// HTTP/React/provider calls here). Money is always integer minor units
// plus an ISO-like currency code (ADR 0004); never floating point.

export function formatMoney(minorUnits: number, currencyCode: string): string {
  const sign = minorUnits < 0 ? "-" : "";
  return `${sign}${currencyCode} ${(Math.abs(minorUnits) / 100).toFixed(2)}`;
}

export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

// Cash-up variance (sprints.md Sprint 3): counted vs expected, and
// whether it needs owner/manager review per the tenant's threshold.
// Mirrors stockflow_close_cash_session's server-side logic
// (lib/db/migrations/0008_sales_cashup_rls_and_functions.sql) so the
// client can show the same number before the round trip — the server
// call remains the authority, this is for UI preview/tests only.
export function computeCashVariance(
  countedMinor: number,
  expectedMinor: number,
  thresholdMinor: number,
): { varianceMinor: number; requiresReview: boolean } {
  const varianceMinor = countedMinor - expectedMinor;
  return { varianceMinor, requiresReview: Math.abs(varianceMinor) > thresholdMinor };
}
