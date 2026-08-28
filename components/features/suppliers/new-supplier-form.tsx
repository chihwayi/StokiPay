"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function NewSupplierForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("suppliers").insert({
      tenant_id: tenantId,
      name: name.trim(),
      phone: phone.trim() || null,
    });
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName("");
    setPhone("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="ghost" className="animate-rise-in min-h-11 self-start px-4 text-sm" onClick={() => setOpen(true)}>
        + New supplier
      </Button>
    );
  }

  return (
    <Card className="animate-rise-in flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="min-h-11" autoFocus />
        <Input placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} className="min-h-11" />
        {error && <span className="text-xs font-medium text-clay">{error}</span>}
        <Button type="submit" disabled={busy} className="min-h-11">
          {busy ? "Saving…" : "Add supplier"}
        </Button>
      </form>
    </Card>
  );
}
