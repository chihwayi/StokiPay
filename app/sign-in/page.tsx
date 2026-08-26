"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { StatusBadge } from "@/components/ui/status-badge";

type Step = "phone" | "otp";

export default function SignInPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devHint, setDevHint] = useState<string | null>(null);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("otp");
    // Staging-only convenience (ADR 0005): before real Africa's Talking
    // sandbox credentials exist, the OTP is only visible server-side.
    // This resolves to null automatically once real credentials are set.
    try {
      const res = await fetch(`/api/auth/dev-otp?phone=${encodeURIComponent(phone)}`);
      const data = await res.json();
      if (data.otp) {
        setDevHint(data.otp);
        setCode(data.otp);
      }
    } catch {
      // dev convenience only — ignore failures
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        Sign in to StockFlow ZW
      </h1>

      {step === "phone" && (
        <form onSubmit={requestOtp} className="flex flex-col gap-3">
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
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={verifyOtp} className="flex flex-col gap-3">
          {devHint && (
            <StatusBadge tone="warning">Dev mode: code auto-filled ({devHint})</StatusBadge>
          )}
          <label className="text-sm text-slate-600 dark:text-slate-400" htmlFor="code">
            Verification code
          </label>
          <input
            id="code"
            type="text"
            required
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-teal-700 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify & continue"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </main>
  );
}
