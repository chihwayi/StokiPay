"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

const VERTICALS = [
  { value: "general_retail", label: "General retail", blurb: "Tuck shop, grocery, general dealer" },
  { value: "bottle_store", label: "Bottle store", blurb: "Beverages and off-license sales" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState("general_retail");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.phone) {
      setError("Your session has expired — please sign in again.");
      setBusy(false);
      return;
    }

    const { error } = await supabase.rpc("stockflow_onboard_tenant", {
      p_tenant_name: name,
      p_vertical: vertical,
      p_owner_phone: user.phone,
    });

    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <div className="animate-rise-in flex flex-col gap-2">
        <span className="text-sm font-semibold uppercase tracking-widest text-teal">
          Step 1 of 1
        </span>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          Tell us about your business
        </h1>
        <p className="text-foreground-muted">
          One shop to start — you can add branches later.
        </p>
      </div>

      <Card accent className="animate-rise-in flex flex-col gap-6">
        <form onSubmit={submit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Business name</Label>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tendai's Tuck Shop"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="vertical">Business type</Label>
            <div role="radiogroup" className="flex flex-col gap-2">
              {VERTICALS.map((v) => (
                <label
                  key={v.value}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-2xl border-2 px-4 py-3 transition-colors ${
                    vertical === v.value
                      ? "border-marigold bg-marigold-soft"
                      : "border-border bg-surface hover:border-marigold/50"
                  }`}
                >
                  <span className="flex items-center gap-2 font-semibold text-foreground">
                    <input
                      type="radio"
                      name="vertical"
                      value={v.value}
                      checked={vertical === v.value}
                      onChange={() => setVertical(v.value)}
                      className="accent-marigold"
                    />
                    {v.label}
                  </span>
                  <span className="pl-6 text-sm text-foreground-muted">{v.blurb}</span>
                </label>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Setting up…" : "Create my business"}
          </Button>
        </form>
        {error && <p className="text-sm font-medium text-clay">{error}</p>}
      </Card>
    </main>
  );
}
