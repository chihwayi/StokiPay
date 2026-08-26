// In-memory, single-instance store for the dev-fallback SMS path only
// (lib/integrations/sms.ts). Never populated when real Africa's Talking
// credentials are configured, so this has no effect once ADR 0005's real
// provider path is live. Staging-only convenience, not a production
// mechanism — do not use for anything beyond letting a human click through
// the signup flow before sandbox SMS credentials exist.
const store = new Map<string, { otp: string; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000;

export function rememberDevOtp(phone: string, otp: string) {
  store.set(phone, { otp, expiresAt: Date.now() + TTL_MS });
}

export function readDevOtp(phone: string): string | null {
  const entry = store.get(phone);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.otp;
}
