"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Owner/manager sign-off via stockflow_resolve_stock_conflict
// (lib/db/migrations/0017...) — requires a note (e.g. "recounted
// physical stock", "reordered from supplier") so the resolution itself
// is auditable, not just a checkbox.
export function ResolveConflictForm({ conflictId }: { conflictId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) {
      setError("A resolution note is required");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("stockflow_resolve_stock_conflict", {
      p_conflict_id: conflictId,
      p_resolution_note: note.trim(),
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        placeholder="Resolution note (e.g. recounted, reordered)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="min-h-10 flex-1 text-sm"
      />
      <Button type="submit" disabled={busy} className="min-h-10 px-4 text-sm">
        {busy ? "Saving…" : "Resolve"}
      </Button>
      {error && <span className="text-xs font-medium text-clay">{error}</span>}
    </form>
  );
}
