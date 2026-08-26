"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/auth/supabase-browser";
import { StatusBadge } from "@/components/ui/status-badge";

const STORAGE_KEY = "stockflow_device_id";

// Registers a stable device_id for this browser (ADR 0003's device_id
// half of the operation_id/device_id idempotency contract) the first time
// a signed-in staff member reaches the dashboard. Real offline write
// adapters land in Sprint 2+ (ADR 0002) — this only proves the identity
// half of that contract end to end.
export function DeviceRegistration() {
  const [status, setStatus] = useState<"checking" | "registered" | "error">("checking");

  useEffect(() => {
    let cancelled = false;

    async function register() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      let deviceId = localStorage.getItem(STORAGE_KEY);
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem(STORAGE_KEY, deviceId);
      }

      const { data: staffUser } = await supabase
        .from("staff_users")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!staffUser) return;

      const { error } = await supabase.from("devices").upsert(
        {
          id: deviceId,
          tenant_id: staffUser.tenant_id,
          staff_user_id: user.id,
          device_label: navigator.userAgent.slice(0, 80),
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      if (!cancelled) setStatus(error ? "error" : "registered");
    }

    register();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "checking") return null;
  if (status === "error") {
    return <StatusBadge tone="negative">Device registration failed</StatusBadge>;
  }
  return <StatusBadge tone="neutral">Device registered for offline sync</StatusBadge>;
}
