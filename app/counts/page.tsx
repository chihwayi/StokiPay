import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

const STATUS_TONE = {
  open: "warning",
  submitted: "negative",
  approved: "positive",
} as const;

export default async function StockCountsPage() {
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

  const { data: counts } = await supabase
    .from("stock_counts")
    .select("id, status, created_at, created_by, staff_users!stock_counts_created_by_staff_users_id_fk(display_name, phone)")
    .eq("tenant_id", staffUser.tenant_id)
    .order("created_at", { ascending: false });

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in flex items-center justify-between gap-4">
        <div>
          <Link href="/products" className="text-sm font-semibold text-teal hover:underline">
            ← Products
          </Link>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
            Stock counts
          </h1>
        </div>
        <Link href="/counts/new">
          <Button className="min-h-11 px-4 text-sm">+ New count</Button>
        </Link>
      </header>

      {!counts?.length && (
        <Card accent className="animate-rise-in flex flex-col items-center gap-3 py-10 text-center">
          <p className="font-display text-xl font-semibold text-foreground">No stock counts yet</p>
          <p className="max-w-xs text-sm text-foreground-muted">
            Start a blind count to check counted stock against what the system expects.
          </p>
          <Link href="/counts/new">
            <Button className="mt-1 min-h-11 px-5 text-sm">Start a count</Button>
          </Link>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {counts?.map((c, i) => {
          const counter = Array.isArray(c.staff_users) ? c.staff_users[0] : c.staff_users;
          return (
            <Link key={c.id} href={`/counts/${c.id}`}>
              <Card
                style={{ animationDelay: `${i * 40}ms` }}
                className="animate-rise-in flex items-center justify-between gap-3 hover:border-marigold"
              >
                <div>
                  <p className="font-display text-lg font-semibold text-foreground">
                    {counter?.display_name || counter?.phone || "Count"}
                  </p>
                  <p className="text-xs text-foreground-muted">
                    {new Date(c.created_at).toLocaleString()}
                  </p>
                </div>
                <StatusBadge tone={STATUS_TONE[c.status as keyof typeof STATUS_TONE]}>
                  {c.status}
                </StatusBadge>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
