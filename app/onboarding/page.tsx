"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";

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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        Tell us about your business
      </h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-sm text-slate-600 dark:text-slate-400" htmlFor="name">
          Business name
        </label>
        <input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tendai's Tuck Shop"
          className="rounded-md border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />

        <label className="text-sm text-slate-600 dark:text-slate-400" htmlFor="vertical">
          Business type
        </label>
        <select
          id="vertical"
          value={vertical}
          onChange={(e) => setVertical(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="general_retail">General retail</option>
          <option value="bottle_store">Bottle store</option>
        </select>

        <button
          type="submit"
          disabled={busy}
          className="mt-2 rounded-md bg-teal-700 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Setting up…" : "Create my business"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </main>
  );
}
