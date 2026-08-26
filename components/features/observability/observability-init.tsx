"use client";

import { useEffect } from "react";
import { initPostHog } from "@/lib/observability/posthog";
import { initSentry } from "@/lib/observability/sentry";

export function ObservabilityInit() {
  useEffect(() => {
    initSentry();
    initPostHog();
  }, []);
  return null;
}
