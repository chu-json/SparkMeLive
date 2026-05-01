// =============================================================================
// POST /api/auth/login
//
// Auth flow:
//   1. Participant submits their study_id
//   2. Server looks up the participants table (service role — bypasses RLS)
//   3. Finds or creates the interview record (service role — bypasses RLS)
//   4. Creates a Supabase Auth user or signs in the existing one
//   5. Returns session tokens + interview id for client-side redirect
//
// IMPORTANT: We use two separate Supabase client instances:
//   - dbClient  → service role, used ONLY for DB reads/writes, NEVER for auth calls
//   - authClient → service role, used ONLY for auth.admin.* + signInWithPassword
//
// Mixing auth sign-in calls with DB calls on the same client instance causes the
// client to replace its internal auth state (service role JWT) with the user's JWT,
// which makes RLS apply to subsequent DB operations. Keeping them separate avoids this.
//
// Extension points:
//   - Magic link: replace signInWithPassword with signInWithOtp() using
//     a real email tied to the study_id
//   - Admin-generated invites: validate an invite token before creating session
//   - Rate limiting: add IP-based rate limiting before the DB lookup
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const studyId = (body.study_id as string | undefined)?.trim();

    if (!studyId) {
      return NextResponse.json({ error: "study_id is required" }, { status: 400 });
    }

    // Detect misconfigured service role key early
    if (
      !process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY === "your-service-role-key-here"
    ) {
      return NextResponse.json(
        {
          error:
            "Server configuration error. SUPABASE_SERVICE_ROLE_KEY is not set in .env.local. See README for setup instructions.",
        },
        { status: 500 }
      );
    }

    // ── DB client — used ONLY for database reads/writes, never for auth calls ──
    const dbClient = createServiceClient();

    // ---- 1. Look up participant ----
    const { data: participant, error: participantError } = await dbClient
      .from("participants")
      .select("*")
      .eq("study_id", studyId)
      .single();

    if (participantError || !participant) {
      if (participantError) {
        const msg = participantError.message ?? "";
        if (
          msg.includes("Invalid API key") ||
          msg.includes("relation") ||
          msg.includes("does not exist")
        ) {
          console.error("[auth/login] DB error:", participantError);
          return NextResponse.json(
            {
              error:
                "Database error. Make sure the schema migration has been applied (supabase/migrations/001_initial.sql).",
            },
            { status: 500 }
          );
        }
      }
      return NextResponse.json(
        { error: "Study ID not found. Please check your ID and try again." },
        { status: 404 }
      );
    }

    if (participant.status === "withdrawn") {
      return NextResponse.json(
        { error: "This study ID is no longer active." },
        { status: 403 }
      );
    }

    // ---- 2. Find or create interview (DB only — before any auth calls) ----
    // Done here with the clean dbClient before auth operations can pollute state.
    const { data: existingInterview } = await dbClient
      .from("interviews")
      .select("id, completed")
      .eq("participant_id", participant.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let interviewId: string;

    if (existingInterview && !existingInterview.completed) {
      interviewId = existingInterview.id;
    } else {
      const { data: newInterview, error: createError } = await dbClient
        .from("interviews")
        .insert({
          participant_id: participant.id,
          mode: "avp",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (createError || !newInterview) {
        console.error("[auth/login] create interview error:", createError);
        return NextResponse.json(
          { error: `Failed to create interview session: ${createError?.message ?? "unknown"}` },
          { status: 500 }
        );
      }
      interviewId = newInterview.id;
    }

    // ── Auth client — used ONLY for auth operations, never for DB calls ──
    // A separate instance so auth session state never bleeds into dbClient.
    const authClient = createServiceClient();

    const email = `${studyId.toLowerCase().replace(/\s+/g, "_")}@sparkme.internal`;
    const password = generateDeterministicPassword(studyId);

    // ---- 3. Create auth user (idempotent) ----
    let authUserId: string;
    const { data: newUser, error: createUserError } = await authClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createUserError) {
      // User already exists — look them up by email
      const { data: listData } = await authClient.auth.admin.listUsers();
      const existing = listData?.users?.find((u) => u.email === email);
      if (!existing) {
        console.error("[auth/login] auth error:", createUserError);
        return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
      }
      authUserId = existing.id;
    } else {
      authUserId = newUser.user.id;
    }

    // ---- 4. Sign in to get a session for the client ----
    const { data: sessionData, error: sessionError } =
      await authClient.auth.signInWithPassword({ email, password });

    if (sessionError || !sessionData.session) {
      console.error("[auth/login] session error:", sessionError);
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    // ---- 5. Link auth_user_id on participant (use a fresh db client to be safe) ----
    const dbClient2 = createServiceClient();
    await dbClient2
      .from("participants")
      .update({ auth_user_id: authUserId })
      .eq("id", participant.id);

    return NextResponse.json({
      participant_id: participant.id,
      interview_id: interviewId,
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
    });
  } catch (err) {
    console.error("[auth/login] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Generate a deterministic password from study_id.
 * NOT a security feature — maps a study_id to a repeatable Supabase credential for MVP.
 * Migrate to magic links before production deployment with real participant data.
 */
function generateDeterministicPassword(studyId: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 16) ?? "sparkme-default";
  return Buffer.from(`${secret}:${studyId}`).toString("base64").slice(0, 32);
}
