"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        Sign in to StockFlow ZW
      </h1>

      <StatusBadge tone="warning">
        Testing mode — phone number not yet SMS-verified (ADR 0005 hook issue, see
        docs/handoffs/sprint-1.md)
      </StatusBadge>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-sm text-slate-600 dark:text-slate-400" htmlFor="phone">
          Phone number
        </label>
        <input
          id="phone"
          type="tel"
          required
          placeholder="+263771234567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-teal-700 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Continue"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </main>
  );
}
