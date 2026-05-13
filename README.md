# SparkMeLive — AVP Interview MVP

A full-stack web application for conducting AVP (Autobiographical Verbal Protocol) life-story interviews. A full-stack web application for conducting AVP (Autobiographical Verbal Protocol) life-story interviews. Built for internal testing by the Stanford CPI and SALT Lab research teams.

**Stack:** Next.js 14 · TypeScript · Tailwind CSS · Supabase (Auth + Postgres + Storage) · OpenAI-compatible LLM API · Deployable to Vercel

---

## Architecture Overview

```
app/                    Next.js App Router pages and API routes
├── login/              Participant auth (study_id → Supabase session)
├── interview/[id]/     Chat interview UI
├── complete/           Post-interview completion + export download
├── admin/              Internal developer dashboard
└── api/
    ├── auth/login      Study ID authentication
    ├── interview/      turn, create, export endpoints
    └── audio/upload    Raw audio file upload

lib/
├── prompts/
│   ├── interviewer.ts  AVP system prompt (warm, narrative, McAdams-style)
│   ├── planner.ts      PLACEHOLDER: SparkMe exploration_planner stub
│   └── memory.ts       PLACEHOLDER: SparkMe agenda_manager stub
├── config/
│   ├── protocol.ts     TypeScript types for protocol schema
│   └── avp-protocol.json  Full AVP life-story protocol (12 domains, sub1/sub2/sub3)
├── llm/
│   └── generateNextQuestion.ts  OpenAI-compatible LLM abstraction
├── interview/
│   ├── engine.ts       Interview loop orchestrator
│   └── export.ts       JSON + TXT export generation
├── supabase/           Browser and server Supabase clients
├── transcribe/         AWS Transcribe placeholder stub
└── types/index.ts      Shared TypeScript types

supabase/migrations/001_initial.sql   Full schema + RLS policies
scripts/seed.ts                        Test data creation script
```

### SparkMe Integration Points

The codebase is architected to slot in SparkMe's Python agent modules:

| SparkMe Module | Location in this codebase | Integration Path |
|---|---|---|
| `interviewer/prompts.py` | `lib/prompts/interviewer.ts` | Replace/extend `buildInterviewerSystemPrompt()` |
| `agenda_manager/prompts.py` | `lib/prompts/memory.ts` | Implement `updateMemory()` |
| `exploration_planner/prompts.py` | `lib/prompts/planner.ts` | Implement `generateStrategicQuestions()` |
| `topics.json` (flat) | `lib/config/avp-protocol.json` | AVP protocol with sub1/sub2/sub3 probe tree |

---

## Local Development Setup

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- An OpenAI API key (or Stanford AI Playground key when available)

### 1. Clone and install

```bash
git clone https://github.com/JCNOOB123/SparkMeLive.git
cd SparkMeLive
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

### 3. Set up Supabase

**Apply the database schema:**

Option A — Supabase Dashboard SQL Editor:
1. Go to your project → SQL Editor
2. Paste and run the contents of `supabase/migrations/001_initial.sql`

Option B — Supabase CLI:
```bash
npx supabase db push
```

**Create Storage buckets:**

In your Supabase dashboard → Storage → New bucket:
1. `audio` — private, for raw audio recordings
2. `exports` — private, for JSON/TXT export files

**Enable Anonymous Sign-ins** (required for the auth flow):
- Dashboard → Authentication → Providers → Anonymous → Enable

### 4. Seed test data

```bash
npm run seed
```

This creates participant `TEST001` and a sample interview session.

### 5. Start the dev server

```bash
npm run dev
```

Visit:
- **Interview login:** http://localhost:3000/login (enter `TEST001`)
- **Admin dashboard:** http://localhost:3000/admin
- **Direct interview:** http://localhost:3000/interview/[id]

---

## Vercel Deployment

### 1. Push to GitHub

```bash
git add .
git commit -m "Initial AVP Interview MVP"
git push origin main
```

### 2. Import project in Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Framework preset: **Next.js** (auto-detected)
4. Add environment variables (same as `.env` above)

### 3. Deploy

Click Deploy. Vercel handles the Next.js build automatically.

Your app will be live at `https://your-project.vercel.app`.

**Note:** Vercel's API routes have a default 10s timeout. The LLM call in `/api/interview/turn` may take 5–15 seconds depending on the model. For production, consider:
- Upgrading to Vercel Pro (60s function timeout)
- Or using Vercel Edge Functions with streaming responses

---

## Supabase Setup Detail

### Row Level Security

RLS is enabled on all tables. Policies allow authenticated users to read only their own data. All writes go through server API routes using the service role key (bypasses RLS).

**Before real participant data deployment:**
- Review RLS policies in `supabase/migrations/001_initial.sql`
- Consider migrating auth to magic links (`signInWithOtp`) instead of the current deterministic password scheme
- Add admin role policies for the research team

### Storage Bucket Policies

After creating the buckets, add these policies in **Supabase → Storage → Policies**:

**audio bucket (allow authenticated user to read own files):**
```sql
CREATE POLICY "auth users can read own audio"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'audio'
  AND auth.role() = 'authenticated'
);
```

**exports bucket:**
```sql
CREATE POLICY "auth users can read own exports"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'exports'
  AND auth.role() = 'authenticated'
);
```

All uploads happen server-side via service role and bypass storage RLS.

---

## Interview Protocol

The AVP protocol is defined in `lib/config/avp-protocol.json`. It has 12 life-story domains:

1. Peak Experience
2. Low Point
3. Turning Point
4. Earliest Memory
5. Positive Childhood Memory
6. Negative/Difficult Childhood Memory
7. Important Adult Experience
8. Challenge or Adversity
9. Meaningful Relationship
10. Personal Beliefs and Values
11. Future Chapter
12. Life Theme

Each domain has:
- `sub1` probes: primary questions (must be asked in order)
- `sub2` probes: follow-up deepening questions (children of sub1)
- `sub3` probes: deepest layer (children of sub2)

To customize for a different protocol, edit `lib/config/avp-protocol.json` or create a new protocol file and update `app/api/interview/turn/route.ts` to import it.

---

## Changing the LLM

All LLM calls go through `lib/llm/generateNextQuestion.ts`.

**Switch to Stanford AI Playground (when access is granted):**
```env
OPENAI_BASE_URL=https://stanford-ai-playground-endpoint.example.com/v1
OPENAI_API_KEY=your-stanford-key
OPENAI_MODEL=gpt-4o
```

**Switch model:**
```env
OPENAI_MODEL=gpt-4o
# or: gpt-4o-mini (cheaper, faster)
# or: gpt-5-mini (when available)
```

No code changes needed — only env var changes.

---

## AWS Transcribe (Future)

Audio is currently saved as raw files in Supabase Storage. AWS Transcribe integration is stubbed in `lib/transcribe/index.ts`.

When ready to activate:
1. Install AWS SDK: `npm install @aws-sdk/client-transcribe @aws-sdk/client-s3`
2. Add env vars: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_TRANSCRIBE_BUCKET`
3. Implement `startTranscriptionJob()` in `lib/transcribe/index.ts`
4. Uncomment the integration call in `app/api/audio/upload/route.ts`

Reference:
- [AWS Transcribe docs](https://docs.aws.amazon.com/transcribe/latest/dg/getting-started.html)
- [AWS SDK v3 quickstart](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-started-nodejs.html)

---

## Admin Dashboard

Visit `/admin` for the internal developer dashboard:
- View all participants and their interview status
- Navigate directly to any interview session
- Generate and download JSON/TXT exports
- See audio recording status

**Security note:** The admin route has no authentication in MVP. Before sharing the deployment URL outside the core team, add basic protection:
```ts
// app/admin/page.tsx — add at top:
if (process.env.ADMIN_ENABLED !== "true") notFound()
```
And set `ADMIN_ENABLED=true` only in your local/staging `.env`.

---

## Export Format

### JSON Export (`export.json`)

```json
{
  "participant_id": "uuid",
  "study_id": "TEST001",
  "interview_id": "uuid",
  "mode": "avp",
  "started_at": "ISO timestamp",
  "ended_at": "ISO timestamp",
  "completed": true,
  "audio_url": "signed URL or null",
  "transcript": [
    {
      "turn_index": 0,
      "speaker": "interviewer",
      "text": "...",
      "timestamp_start": "ISO timestamp",
      "timestamp_end": "ISO timestamp"
    }
  ],
  "metadata": {
    "exported_at": "ISO timestamp",
    "total_turns": 12,
    "version": "1.0.0"
  }
}
```

### TXT Export (`export.txt`)

Plain-text transcript with headers and labeled turns:
```
========================================================================
AVP LIFE STORY INTERVIEW TRANSCRIPT
========================================================================
Study ID:      TEST001
Interview ID:  ...
...
------------------------------------------------------------------------
TRANSCRIPT
------------------------------------------------------------------------

INTERVIEWER [Jan 1, 2026, 10:00:00 AM PST]
Thank you so much for being here today...

PARTICIPANT  [Jan 1, 2026, 10:01:00 AM PST]
...
```

---

## Running Tests / Self-Interview

To test the system end-to-end before the David evaluation:

1. `npm run seed` — creates TEST001 participant
2. `npm run dev`
3. Visit http://localhost:3000/login, enter `TEST001`
4. Complete a short interview (5–10 turns)
5. Visit http://localhost:3000/admin to inspect transcript and download export
6. Compare the transcript structure against qualitative notes from actual AVP interviews

---

## Citation

If using SparkMe's architecture in publications:

```bibtex
@article{anugraha2026sparkme,
  title={SparkMe: Adaptive Semi-Structured Interviewing for Qualitative Insight Discovery},
  author={Anugraha, David and Padmakumar, Vishakh and Yang, Diyi},
  journal={arXiv preprint arXiv:2602.21136},
  year={2026}
}
```
