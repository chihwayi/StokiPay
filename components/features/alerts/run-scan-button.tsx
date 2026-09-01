"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Manual trigger for /api/ai/anomaly-scan — no scheduler exists yet
// (docs/handoffs/sprint-7.md), so an owner/manager runs the scan
// on-demand from here.
export function RunScanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/ai/anomaly-scan", { method: "POST" });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMessage(body.error ?? "Scan failed");
      return;
    }
    setMessage(body.createdCount > 0 ? `${body.createdCount} new alert(s) found` : "No new alerts");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <Button type="button" onClick={run} disabled={busy} className="min-h-10 px-4 text-sm">
        {busy ? "Scanning…" : "Run scan"}
      </Button>
      {message && <span className="text-xs text-foreground-muted">{message}</span>}
    </div>
  );
}
