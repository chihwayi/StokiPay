import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function money(minor: number, currency: string) {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

export default async function ReturnsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: staffUser } = await supabase
    .from("staff_users")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!staffUser) redirect("/onboarding");

  const { data: sales } = await supabase
    .from("sales")
    .select("id, amount_minor, currency_code, created_at")
    .eq("tenant_id", staffUser.tenant_id)
    .order("created_at", { ascending: false })
    .limit(25);

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in flex items-center justify-between gap-4">
        <div>
          <Link href="/pos" className="text-sm font-semibold text-teal hover:underline">
            ← Sell
          </Link>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Returns</h1>
        </div>
      </header>

      {!sales?.length && (
        <Card accent className="animate-rise-in flex flex-col items-center gap-3 py-10 text-center">
          <p className="font-display text-xl font-semibold text-foreground">No sales yet</p>
          <p className="max-w-xs text-sm text-foreground-muted">Once a sale syncs, it will show up here to select for a return.</p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {sales?.map((s, i) => (
          <Link key={s.id} href={`/returns/${s.id}`}>
            <Card className="animate-rise-in flex items-center justify-between" style={{ animationDelay: `${i * 30}ms` }}>
              <div>
                <p className="font-display text-lg font-semibold text-foreground">
                  {money(s.amount_minor, s.currency_code)}
                </p>
                <p className="text-xs text-foreground-muted">{new Date(s.created_at).toLocaleString()}</p>
              </div>
              <Button variant="ghost" className="min-h-10 px-4 text-sm">
                Return
              </Button>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
