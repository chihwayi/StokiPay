import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { SyncStatusIndicator } from "@/components/features/sync/sync-status-indicator";
import { DeviceRegistration } from "@/components/features/auth/device-registration";
import { Card } from "@/components/ui/card";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Mangwanani";
  if (hour < 18) return "Masikati";
  return "Manheru";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: staffUser } = await supabase
    .from("staff_users")
    .select("role, tenant_id, tenants(name, vertical)")
    .eq("id", user.id)
    .maybeSingle();

  if (!staffUser) {
    redirect("/onboarding");
  }

  const tenant = Array.isArray(staffUser.tenants) ? staffUser.tenants[0] : staffUser.tenants;

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold uppercase tracking-widest text-teal">
            {greeting()}
          </span>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
            {tenant?.name ?? "Your business"}
          </h1>
          <p className="text-sm text-foreground-muted">
            {user.phone} · <span className="capitalize">{staffUser.role}</span>
          </p>
        </div>
        <SyncStatusIndicator />
      </header>

      <div style={{ animationDelay: "80ms" }} className="animate-rise-in">
        <DeviceRegistration />
      </div>

      <Card
        accent
        className="animate-rise-in flex min-h-56 flex-col items-center justify-center gap-3 text-center"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-soft text-2xl">
          📦
        </span>
        <p className="font-display text-xl font-semibold text-foreground">
          No sales or stock yet
        </p>
        <p className="max-w-xs text-sm text-foreground-muted">
          Product, stock and sales screens are built in later sprints per{" "}
          <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs">sprints.md</code>.
        </p>
      </Card>
    </main>
  );
}
