"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";

export default function SignInPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/request-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Sign-in failed");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <div className="animate-rise-in flex flex-col items-center gap-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-marigold text-2xl font-bold text-white shadow-[0_4px_0_0_var(--marigold-strong)]">
          SF
        </span>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground">
          StockFlow ZW
        </h1>
        <p className="text-foreground-muted">
          Track stock, sales and profit — even offline.
        </p>
      </div>

      <Card accent className="animate-rise-in flex flex-col gap-5">
        <div style={{ animationDelay: "80ms" }} className="animate-rise-in">
          <StatusBadge tone="warning">Testing mode — phone not yet SMS-verified</StatusBadge>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div style={{ animationDelay: "140ms" }} className="animate-rise-in flex flex-col gap-2">
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              type="tel"
              required
              placeholder="+263 77 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div style={{ animationDelay: "200ms" }} className="animate-rise-in">
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Signing in…" : "Continue"}
            </Button>
          </div>
        </form>

        {error && <p className="text-sm font-medium text-clay">{error}</p>}
      </Card>
    </main>
  );
}
