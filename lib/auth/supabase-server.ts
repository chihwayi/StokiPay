import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// RLS-scoped client — every query through this respects the requesting
// user's session (anon/authenticated role + their JWT), never bypasses
// tenant isolation. See docs/runbooks/coolify-deployment.md's RLS
// boundary rules.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component without a mutable cookie
            // jar — safe to ignore, middleware refreshes the session.
          }
        },
      },
    },
  );
}
