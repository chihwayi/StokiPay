import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { OpenSessionForm } from "@/components/features/cashup/open-session-form";
import { CloseSessionForm } from "@/components/features/cashup/close-session-form";
import { VarianceReview } from "@/components/features/cashup/variance-review";

export default async function CashUpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: staffUser } = await supabase
    .from("staff_users")
    .select("role, tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!staffUser) redirect("/onboarding");

  const { data: branch } = await supabase
    .from("branches")
    .select("id, name")
    .eq("tenant_id", staffUser.tenant_id)
    .eq("is_primary", true)
    .maybeSingle();

  if (!branch) {
    return (
      <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
        <p className="text-sm text-foreground-muted">No branch set up yet.</p>
      </main>
    );
  }

  const { data: openSession } = await supabase
    .from("cash_sessions")
    .select("id, opening_float_minor, opening_currency, opened_at")
    .eq("tenant_id", staffUser.tenant_id)
    .eq("branch_id", branch.id)
    .eq("status", "open")
    .maybeSingle();

  const canReview = staffUser.role === "owner" || staffUser.role === "manager";
  const { data: pendingVariances } = canReview
    ? await supabase
        .from("cash_variances")
        .select("id, cash_session_id, tender_type, currency_code, expected_amount_minor, counted_amount_minor, variance_minor, reason")
        .eq("tenant_id", staffUser.tenant_id)
        .eq("requires_review", true)
        .is("reviewed_at", null)
    : { data: [] };

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in">
        <Link href="/dashboard" className="text-sm font-semibold text-teal hover:underline">
          ← Dashboard
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Cash-up</h1>
      </header>

      {openSession ? (
        <CloseSessionForm
          cashSessionId={openSession.id}
          openingFloatMinor={openSession.opening_float_minor}
          openingCurrency={openSession.opening_currency}
          openedAt={openSession.opened_at}
        />
      ) : (
        <OpenSessionForm tenantId={staffUser.tenant_id} branchId={branch.id} />
      )}

      {canReview && pendingVariances && pendingVariances.length > 0 && (
        <VarianceReview variances={pendingVariances} />
      )}
    </main>
  );
}
