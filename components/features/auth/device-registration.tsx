"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/auth/supabase-browser";
import { StatusBadge } from "@/components/ui/status-badge";
import { getOrCreateDeviceId } from "@/lib/sync/device-id";
import { connectPowerSync } from "@/lib/sync/db";

// Registers a stable device_id for this browser (ADR 0003's device_id
// half of the operation_id/device_id idempotency contract) the first time
// a signed-in staff member reaches the dashboard, then connects the local
// PowerSync database (ADR 0002) so offline-safe writes (Sprint 2 stock
// forms, Sprint 3 POS/returns/cash-up) have somewhere to queue into.
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

      const deviceId = getOrCreateDeviceId();

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

      if (!error) {
        // Best-effort: a device that can't reach the PowerSync service yet
        // still has a registered identity and can retry later — it must
        // never block the rest of the app from loading.
        connectPowerSync().catch((e) => console.error("PowerSync connect failed:", e));
      }
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
