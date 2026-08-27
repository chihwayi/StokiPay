"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";

// Opens a new blind stock count and immediately routes into it — no form
// needed, the count itself has no fields beyond who/where/when.
export default function NewStockCountPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function create() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return router.replace("/sign-in");

      const { data: staffUser } = await supabase
        .from("staff_users")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!staffUser) return router.replace("/onboarding");

      const { data: branch } = await supabase
        .from("branches")
        .select("id")
        .eq("tenant_id", staffUser.tenant_id)
        .eq("is_primary", true)
        .maybeSingle();
      if (!branch) return router.replace("/counts");

      const { data: created, error } = await supabase
        .from("stock_counts")
        .insert({ tenant_id: staffUser.tenant_id, branch_id: branch.id, created_by: user.id })
        .select("id")
        .single();

      if (cancelled) return;
      if (error || !created) return router.replace("/counts");
      router.replace(`/counts/${created.id}`);
    }

    create();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <p className="text-foreground-muted">Starting a new count…</p>
    </main>
  );
}
