import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ResolveConflictForm } from "@/components/features/conflicts/resolve-conflict-form";

export default async function ConflictsPage() {
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
  if (staffUser.role !== "owner" && staffUser.role !== "manager") redirect("/dashboard");

  const { data: conflicts } = await supabase
    .from("stock_conflicts")
    .select("id, product_id, resulting_quantity, resolved, resolution_note, created_at, products(name)")
    .eq("tenant_id", staffUser.tenant_id)
    .order("created_at", { ascending: false });

  const unresolved = (conflicts ?? []).filter((c) => !c.resolved);
  const resolved = (conflicts ?? []).filter((c) => c.resolved);

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in">
        <Link href="/dashboard" className="text-sm font-semibold text-teal hover:underline">
          ← Dashboard
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Stock conflicts</h1>
        <p className="text-xs text-foreground-muted">
          Created automatically when two devices sell the same last unit while offline — the sales themselves are never undone.
        </p>
      </header>

      {conflicts?.length === 0 && (
        <Card accent className="animate-rise-in flex flex-col items-center gap-2 py-10 text-center">
          <p className="font-display text-xl font-semibold text-foreground">No conflicts</p>
          <p className="max-w-xs text-sm text-foreground-muted">Stock has never gone negative from a multi-device sale.</p>
        </Card>
      )}

      {unresolved.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-foreground">Needs review ({unresolved.length})</p>
          {unresolved.map((c) => (
            <Card key={c.id} className="animate-rise-in flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="font-display text-lg font-semibold text-foreground">
                  {(c.products as unknown as { name: string } | null)?.name ?? "Item"}
                </p>
                <StatusBadge tone="negative">{c.resulting_quantity} on hand</StatusBadge>
              </div>
              <p className="text-xs text-foreground-muted">{new Date(c.created_at).toLocaleString()}</p>
              <ResolveConflictForm conflictId={c.id} />
            </Card>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-foreground">Resolved</p>
          {resolved.map((c) => (
            <Card key={c.id} className="flex flex-col gap-1 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">
                  {(c.products as unknown as { name: string } | null)?.name ?? "Item"}
                </p>
                <StatusBadge tone="positive">Resolved</StatusBadge>
              </div>
              {c.resolution_note && <p className="text-xs text-foreground-muted">{c.resolution_note}</p>}
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
