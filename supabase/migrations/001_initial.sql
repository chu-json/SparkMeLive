-- =============================================================================
-- SparkMeLive AVP Interview MVP — Initial Schema
-- Run this in the Supabase SQL editor or via `supabase db push`
--
-- Security note:
--   RLS policies here are MVP-safe but not production-hardened.
--   Before deploying with real participant data, review:
--     1. Tighten participant lookup to require JWT claims or magic links
--     2. Add admin role with broader SELECT access
--     3. Audit storage bucket policies (currently public-read for exports)
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- participants
-- Represents a study enrollee. May or may not have a Supabase Auth user yet.
-- auth_user_id is set when the participant authenticates via Supabase Auth.
-- =============================================================================
CREATE TABLE IF NOT EXISTS participants (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  study_id        text UNIQUE NOT NULL,
  auth_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'completed', 'withdrawn')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for fast study_id lookups during auth flow
CREATE INDEX IF NOT EXISTS participants_study_id_idx ON participants(study_id);
CREATE INDEX IF NOT EXISTS participants_auth_user_id_idx ON participants(auth_user_id);

-- =============================================================================
-- interviews
-- One interview session per participant (MVP: one active interview at a time).
-- audio_path and transcript_path point to Supabase Storage objects.
-- =============================================================================
CREATE TABLE IF NOT EXISTS interviews (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id  uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  started_at      timestamptz,
  ended_at        timestamptz,
  completed       boolean NOT NULL DEFAULT false,
  audio_path      text,
  transcript_path text,
  -- Interview mode: 'avp' for life-story, extensible for other protocols
  mode            text NOT NULL DEFAULT 'avp',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interviews_participant_id_idx ON interviews(participant_id);

-- =============================================================================
-- transcript_turns
-- Every turn in the interview: both interviewer and interviewee turns.
-- The transcript can be fully reconstructed from these rows ordered by turn_index.
-- =============================================================================
CREATE TABLE IF NOT EXISTS transcript_turns (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  interview_id    uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  turn_index      integer NOT NULL,
  speaker         text NOT NULL CHECK (speaker IN ('interviewer', 'interviewee')),
  text            text NOT NULL,
  timestamp_start timestamptz,
  timestamp_end   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, turn_index)
);

CREATE INDEX IF NOT EXISTS transcript_turns_interview_id_idx ON transcript_turns(interview_id);
CREATE INDEX IF NOT EXISTS transcript_turns_interview_id_turn_index_idx
  ON transcript_turns(interview_id, turn_index);

-- =============================================================================
-- interview_exports
-- Tracks generated export files stored in Supabase Storage.
-- json_path → exports/{interview_id}/export.json
-- txt_path  → exports/{interview_id}/export.txt
-- =============================================================================
CREATE TABLE IF NOT EXISTS interview_exports (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  interview_id    uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  json_path       text,
  txt_path        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interview_exports_interview_id_idx ON interview_exports(interview_id);

-- =============================================================================
-- Row Level Security
--
-- Strategy:
--   - All mutations happen server-side via SUPABASE_SERVICE_ROLE_KEY
--     which bypasses RLS. Server routes are the authoritative write path.
--   - Client-side (anon key) can only SELECT rows owned by the authenticated user.
--   - This keeps the client-side surface minimal and safe for MVP.
--
-- IMPORTANT: These are MVP policies. Before production:
--   - Add proper admin role policies
--   - Consider whether client-side reads are needed at all (vs. server components)
--   - Audit that auth_user_id linkage is tamper-proof
-- =============================================================================

ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_exports ENABLE ROW LEVEL SECURITY;

-- Participants: authenticated user can read their own record
CREATE POLICY "participants_select_own"
  ON participants FOR SELECT
  USING (auth.uid() = auth_user_id);

-- Interviews: authenticated user can read their own interviews
CREATE POLICY "interviews_select_own"
  ON interviews FOR SELECT
  USING (
    participant_id IN (
      SELECT id FROM participants WHERE auth_user_id = auth.uid()
    )
  );

-- Transcript turns: authenticated user can read turns from their own interviews
CREATE POLICY "transcript_turns_select_own"
  ON transcript_turns FOR SELECT
  USING (
    interview_id IN (
      SELECT i.id FROM interviews i
      JOIN participants p ON p.id = i.participant_id
      WHERE p.auth_user_id = auth.uid()
    )
  );

-- Interview exports: authenticated user can read their own exports
CREATE POLICY "interview_exports_select_own"
  ON interview_exports FOR SELECT
  USING (
    interview_id IN (
      SELECT i.id FROM interviews i
      JOIN participants p ON p.id = i.participant_id
      WHERE p.auth_user_id = auth.uid()
    )
  );

-- =============================================================================
-- Storage buckets
-- Create via Supabase dashboard or add to storage policies after applying schema.
--
-- Buckets to create:
--   1. audio     — private, for raw audio recordings
--   2. exports   — private, for JSON + TXT export files
--
-- Storage RLS (apply in Supabase dashboard → Storage → Policies):
--   audio: authenticated user can read their own audio path
--   exports: authenticated user can read their own export files
--
-- All uploads happen server-side via service role (bypasses storage RLS).
-- =============================================================================
