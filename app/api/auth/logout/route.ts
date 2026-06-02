// =============================================================================
// GET /api/auth/logout
//
// Clears the Supabase auth session cookies and redirects to /login.
//
// This exists primarily to break the "/" <-> "/login" redirect loop that can
// occur when a stale auth cookie still resolves to a valid Supabase user
// (the JWT is refreshable) but the linked `participants` / `interviews` rows
// no longer exist — e.g. after the database is reseeded or migrations change
// during development. In that situation `app/page.tsx` would redirect to
// `/login`, the middleware would see a valid `user` and bounce back to `/`,
// and the browser would spin forever issuing GET requests.
//
// Server Components cannot write cookies, so the orphan-session cleanup has to
// happen here in a Route Handler. `/api/*` is excluded from the middleware
// matcher, so there is no competing session-refresh writing cookies on this
// request.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  // `scope: "local"` clears the cookies on this device without requiring a
  // valid server-side session, so it works even when the session is broken.
  await supabase.auth.signOut({ scope: "local" });

  return NextResponse.redirect(new URL("/login", req.url));
}
