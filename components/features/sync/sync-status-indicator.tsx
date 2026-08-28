"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { getPowerSyncDb } from "@/lib/sync/db";

type SyncState = "offline" | "connecting" | "syncing" | "synced" | "failed";

// Reflects PowerSync's real connection/upload/download state (ADR 0002),
// not just browser online/offline — a device can be "online" but still
// have queued local writes waiting to upload, or briefly disconnected
// from the sync service while the network itself is fine.
export function SyncStatusIndicator() {
  const [state, setState] = useState<SyncState>("connecting");

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;

    async function attach() {
      try {
        const db = getPowerSyncDb();
        const apply = (connected: boolean, uploading: boolean, downloading: boolean, hasSynced: boolean) => {
          if (cancelled) return;
          if (!connected) {
            setState(navigator.onLine ? "connecting" : "offline");
          } else if (uploading || downloading) {
            setState("syncing");
          } else if (hasSynced) {
            setState("synced");
          } else {
            setState("connecting");
          }
        };

        apply(
          db.currentStatus.connected,
          db.currentStatus.dataFlowStatus.uploading,
          db.currentStatus.dataFlowStatus.downloading,
          db.currentStatus.hasSynced ?? false,
        );

        dispose = db.registerListener({
          statusChanged(status) {
            apply(
              status.connected,
              status.dataFlowStatus.uploading,
              status.dataFlowStatus.downloading,
              status.hasSynced ?? false,
            );
          },
        });
      } catch {
        setState("failed");
      }
    }

    attach();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  const copy: Record<SyncState, { tone: "neutral" | "positive" | "warning" | "negative"; label: string }> = {
    offline: { tone: "warning", label: "Offline — changes will sync later" },
    connecting: { tone: "neutral", label: "Connecting…" },
    syncing: { tone: "warning", label: "Syncing…" },
    synced: { tone: "positive", label: "Synced" },
    failed: { tone: "negative", label: "Sync unavailable" },
  };

  const { tone, label } = copy[state];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}
