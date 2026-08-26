import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely. Never import this from a
// client component and never expose SUPABASE_SERVICE_ROLE_KEY to the
// browser. Only used for the privileged, transaction-scoped onboarding/
// staff-invite writes described in ADR 0006 — each caller is responsible
// for its own explicit authorization check before writing, since RLS
// itself provides none here.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
