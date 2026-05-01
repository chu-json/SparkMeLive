// Server-side Supabase client — reads session from cookies
// Use this in Server Components, Route Handlers, and Server Actions
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

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
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll is called from Server Components where cookies can't be set.
            // This is fine — the middleware handles session refresh.
          }
        },
      },
    }
  );
}

/**
 * Service-role client — bypasses RLS completely.
 * Uses the plain supabase-js createClient (NOT the SSR wrapper) so that the
 * service role key is applied correctly and RLS is skipped on all operations.
 *
 * NEVER expose this client or the service role key to the browser.
 * Security note: Before production, audit every call to this function
 * to ensure it is only reachable from server-side code.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
