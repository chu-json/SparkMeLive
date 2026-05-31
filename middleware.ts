import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — IMPORTANT: do not add logic between createServerClient
  // and getUser() or the session refresh may not propagate correctly.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Protect /interview and /complete routes — redirect to login if not authenticated
  const protectedPaths = ["/interview", "/complete"];
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));

  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // If user is already authenticated and hits /login, redirect to their session
  // (Admin route is intentionally NOT redirected — developers access it directly)
  //
  // EXCEPTION: when /login carries a `?id=` query string we treat that as an
  // explicit "switch participant" intent (admin "Login as" link). Letting it
  // through means the LoginForm can auto-submit with the requested study_id
  // and `setSession()` will replace the current session in place — without
  // this exception the redirect to `/` would send the admin back to whichever
  // participant their browser is currently signed in as.
  if (pathname === "/login" && user) {
    const hasIdParam = request.nextUrl.searchParams.has("id");
    if (!hasIdParam) {
      const homeUrl = request.nextUrl.clone();
      homeUrl.pathname = "/";
      return NextResponse.redirect(homeUrl);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - /api routes (handled by their own auth checks)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
