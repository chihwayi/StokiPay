const STORAGE_KEY = "stockflow_device_id";

// The stable per-browser device_id from ADR 0003's idempotency contract.
// components/features/auth/device-registration.tsx creates this on first
// dashboard visit; every local-first write (stock receipts, adjustments,
// sales in later sprints) reads it from here.
export function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function getOrCreateDeviceId(): string {
  const existing = getDeviceId();
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, created);
  return created;
}
