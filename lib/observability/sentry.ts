import * as Sentry from "@sentry/nextjs";

// No-ops unless NEXT_PUBLIC_SENTRY_DSN is set, so local dev and CI without
// a Sentry project configured are unaffected. Full alerting/release config
// is follow-up work, not a Sprint 0 requirement.
export function initSentry() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, tracesSampleRate: 0.1 });
}
