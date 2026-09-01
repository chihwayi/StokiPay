import { NextResponse } from "next/server";
import { createClient } from "@/lib/auth/supabase-server";
import { createAdminClient } from "@/lib/auth/supabase-admin";

// Manually-triggered anomaly scan (owner/manager button on the dashboard
// — no scheduler exists yet, see docs/handoffs/sprint-7.md). Uses the
// service-role client only because stockflow_run_anomaly_scan takes a
// raw p_tenant_id parameter (migration 0019's comment explains why), but
// that tenant_id is always this route's own session lookup below, never
// a client-supplied value — the privileged client doesn't widen what a
// caller can scan, only who's allowed to invoke the function at all.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: staffUser } = await supabase
    .from("staff_users")
    .select("tenant_id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!staffUser || !["owner", "manager"].includes(staffUser.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("stockflow_run_anomaly_scan", { p_tenant_id: staffUser.tenant_id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ createdCount: data });
}
