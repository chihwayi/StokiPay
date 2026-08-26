import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { SyncStatusIndicator } from "@/components/features/sync/sync-status-indicator";
import { DeviceRegistration } from "@/components/features/auth/device-registration";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-12">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {tenant?.name ?? "Your business"}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Signed in as {user.phone} · {staffUser.role}
          </p>
        </div>
        <SyncStatusIndicator />
      </header>

      <div className="rounded-lg border border-slate-200 p-6 text-center text-slate-500 dark:border-slate-800 dark:text-slate-400">
        No sales or stock yet. Product, stock and sales screens are built in
        later sprints per <code>sprints.md</code>.
      </div>

      <DeviceRegistration />
    </main>
  );
}
