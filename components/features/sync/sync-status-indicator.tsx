"use client";

import { useSyncExternalStore } from "react";
import { StatusBadge } from "@/components/ui/status-badge";

// Reflects browser connectivity only. Real queued/syncing/failed states
// come from the PowerSync operation contract landed in ADR 0002 / Sprint 2+.
function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

export function SyncStatusIndicator() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!isOnline) {
    return <StatusBadge tone="warning">Offline — changes will sync later</StatusBadge>;
  }
  return <StatusBadge tone="positive">Online</StatusBadge>;
}
