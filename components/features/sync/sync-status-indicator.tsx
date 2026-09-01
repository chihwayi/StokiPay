"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { getPowerSyncDb } from "@/lib/sync/db";

type SyncState = "offline" | "connecting" | "syncing" | "synced" | "failed";

// Reflects PowerSync's real connection/upload/download state (ADR 0002),
// not just browser online/offline — a device can be "online" but still
// have queued local writes waiting to upload, or briefly disconnected
// from the sync service while the network itself is fine. "failed"
// (Sprint 6) surfaces PowerSync's own dataFlowStatus.uploadError/
// downloadError — a currently-retrying or exhausted upload/download —
// distinct from "syncing" so a stuck device is visibly different from a
// healthy one still catching up.
export function SyncStatusIndicator() {
  const [state, setState] = useState<SyncState>("connecting");

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;

    async function attach() {
      try {
        const db = getPowerSyncDb();
        const apply = (
          connected: boolean,
          uploading: boolean,
          downloading: boolean,
          hasSynced: boolean,
          uploadError: unknown,
          downloadError: unknown,
        ) => {
          if (cancelled) return;
          if (uploadError || downloadError) {
            setState("failed");
          } else if (!connected) {
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
          db.currentStatus.dataFlowStatus.uploadError,
          db.currentStatus.dataFlowStatus.downloadError,
        );

        dispose = db.registerListener({
          statusChanged(status) {
            apply(
              status.connected,
              status.dataFlowStatus.uploading,
              status.dataFlowStatus.downloading,
              status.hasSynced ?? false,
              status.dataFlowStatus.uploadError,
              status.dataFlowStatus.downloadError,
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
    failed: { tone: "negative", label: "Sync problem — retrying" },
  };

  const { tone, label } = copy[state];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}
