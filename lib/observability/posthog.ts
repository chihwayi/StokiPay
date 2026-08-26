import posthog from "posthog-js";

// No-ops unless NEXT_PUBLIC_POSTHOG_KEY is set. Tenant-safe: do not send
// financial/customer payloads through analytics events (see
// lib/observability/README.md).
export function initPostHog() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    person_profiles: "identified_only",
  });
}
