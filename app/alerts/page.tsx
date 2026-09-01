import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { DismissAlertButton } from "@/components/features/alerts/dismiss-alert-button";
import { RunScanButton } from "@/components/features/alerts/run-scan-button";

export default async function AlertsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: staffUser } = await supabase
    .from("staff_users")
    .select("tenant_id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!staffUser) redirect("/onboarding");

  const { data: alerts } = await supabase
    .from("alerts")
    .select("id, alert_type, message, dismissed, created_at")
    .eq("tenant_id", staffUser.tenant_id)
    .order("created_at", { ascending: false });

  const active = (alerts ?? []).filter((a) => !a.dismissed);
  const dismissed = (alerts ?? []).filter((a) => a.dismissed);
  const canRunScan = staffUser.role === "owner" || staffUser.role === "manager";

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in flex flex-col gap-3">
        <Link href="/dashboard" className="text-sm font-semibold text-teal hover:underline">
          ← Dashboard
        </Link>
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Alerts</h1>
          <p className="text-xs text-foreground-muted">
            Unresolved stock conflicts, unreviewed cash variances and fast-growing customer debt, found by the anomaly scan.
          </p>
        </div>
        {canRunScan && <RunScanButton />}
      </header>

      {(alerts ?? []).length === 0 && (
        <Card accent className="animate-rise-in flex flex-col items-center gap-2 py-10 text-center">
          <p className="font-display text-xl font-semibold text-foreground">No alerts</p>
          <p className="max-w-xs text-sm text-foreground-muted">Nothing unusual has been found yet.</p>
        </Card>
      )}

      {active.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-foreground">Active ({active.length})</p>
          {active.map((a) => (
            <Card key={a.id} className="animate-rise-in flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <StatusBadge tone="negative">{a.alert_type.replace(/_/g, " ")}</StatusBadge>
                <span className="text-xs text-foreground-muted">{new Date(a.created_at).toLocaleString()}</span>
              </div>
              <p className="text-sm text-foreground">{a.message}</p>
              <DismissAlertButton alertId={a.id} />
            </Card>
          ))}
        </div>
      )}

      {dismissed.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-foreground">Dismissed</p>
          {dismissed.map((a) => (
            <Card key={a.id} className="flex flex-col gap-1 py-3">
              <div className="flex items-center justify-between gap-2">
                <StatusBadge tone="positive">Dismissed</StatusBadge>
                <span className="text-xs text-foreground-muted">{new Date(a.created_at).toLocaleString()}</span>
              </div>
              <p className="text-sm text-foreground-muted">{a.message}</p>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
