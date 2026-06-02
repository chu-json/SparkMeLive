# SparkMeLive — Qualitative interview MVP

A full-stack web app for running **semi-structured, multi-domain qualitative interviews** with an AI interviewer. Built for internal testing and future field use by the Stanford CPI and SALT Lab research teams. The UI and pipeline are **SparkMe-inspired** (agenda manager, exploration planner, interviewer) while the **question protocol** is defined in JSON and can be swapped or edited independently of the code.

**Stack:** Next.js 14 · TypeScript · Tailwind CSS · Supabase (Postgres + Storage + anonymous auth) · OpenAI-compatible chat API · optional OpenAI TTS · deployable to Vercel

---
<img width="1687" height="974" alt="image" src="https://github.com/user-attachments/assets/31ec4042-ef06-4f28-baaa-603bb366555c" />


## What participants see

- **Login** (`/login`) — enter a study ID (anonymous Supabase session). Admins can link to `/login?id=YOUR_STUDY_ID` to pre-fill the field.
- **Interview** (`/interview/[id]`) — voice orb, optional **typed** replies, live captions, slide-out **transcript** (on by default), **mute** for AI voice, and **Begin Interview** on first visit so browser audio autoplay rules are satisfied before TTS runs.
- **Export during the interview** — download icon in the **bottom-right** of the control bar saves a `.txt` of the conversation so far (speakers + timestamps), built in the browser from the live transcript.
- **Complete** (`/complete?interview_id=…`) — thank-you page with optional server-generated exports when Storage is configured (see [Exports](#exports)).

---

## What admins see (`/admin`)

The admin dashboard is rendered **dynamically** (not statically cached) so new participants and interviews show up on refresh.

- Create participants (single study ID or bulk seed `TEST001`–`TEST010`).
- Per participant: **Login as** link (with study ID query param), **Delete** with confirmation (removes that participant’s data via API — use only for testing resets).
- Per interview: open session, turn counts, **Export** — calls `POST /api/interview/export` and downloads **`.txt` and `.json`** immediately from the response body (works even if the `exports` bucket is missing; see [Exports](#exports)).
- Configuration **Check now** for env/Supabase diagnostics.

**Security:** `/admin` is not authenticated in the MVP. Before sharing a deployment URL, gate it (for example `ADMIN_ENABLED` + `notFound()` in `app/admin/page.tsx`) or protect the route behind your org’s auth.

---

## Architecture overview

```
app/
├── login/                 Participant login (study ID; optional ?id= prefill)
├── interview/[id]/        Interview UI + client transcript export
├── complete/              Post-interview screen + export links
├── admin/                 Developer dashboard (dynamic server page)
└── api/
    ├── auth/login         Study ID → anonymous Supabase session
    ├── interview/
    │   ├── create         Start / resume interview (idempotent; see below)
    │   ├── turn           Participant message → next AI turn
    │   └── export         Build JSON + TXT export (+ optional Storage upload)
    ├── admin/
    │   ├── participant      Create / delete participants
    │   └── status           Env / connectivity checks
    ├── tts/               Server-side TTS (optional; client can use browser TTS)
    └── audio/upload       Raw audio upload to Storage

lib/
├── prompts/
│   ├── interviewer.ts     System prompt + persona + protocol-aware instructions
│   ├── planner.ts         Exploration planner (strategic questions, utility scoring)
│   └── memory.ts          Agenda manager (coverage, portrait, session summary)
├── config/
│   ├── protocol.ts        TypeScript types for the protocol schema
│   └── avp-protocol.json  Active protocol (topics, sub1/sub2/sub3 probes)
├── llm/
│   └── generateNextQuestion.ts   OpenAI-compatible chat abstraction
├── interview/
│   ├── engine.ts          Turn loop: planner + interviewer + completion checks
│   └── export.ts          JSON + plain-text transcript (+ optional Storage)
├── hooks/                 Speech, recording, TTS (including AudioContext unlock)
├── supabase/              Browser + server Supabase clients
├── transcribe/            AWS Transcribe stub (future)
└── types/index.ts         Shared TypeScript types

supabase/migrations/001_initial.sql   Schema + RLS
scripts/seed.ts                       CLI seed for TEST001
```

### SparkMe alignment

| SparkMe idea | In this repo |
|--------------|----------------|
| Interviewer prompts | `lib/prompts/interviewer.ts` |
| Agenda manager | `lib/prompts/memory.ts` |
| Exploration planner | `lib/prompts/planner.ts` |
| Topic / probe tree | `lib/config/avp-protocol.json` (filename is historical; content is the active protocol) |

---

## Local development

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- An OpenAI-**compatible** chat API key and base URL (see `.env.example` — Stanford AI Playground is documented there)
- Optional: separate OpenAI credentials for **TTS**; if omitted, the app uses the browser’s `SpeechSynthesis` fallback

### 1. Clone and install

```bash
git clone https://github.com/chu-json/SparkMeLive.git
cd SparkMeLive
npm install
```

### 2. Environment variables

```bash
cp .env.example .env
```

Fill in at least:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`
- Optional TTS block: `OPENAI_TTS_API_KEY`, etc. (see `.env.example`)

### 3. Supabase

**Schema:** run `supabase/migrations/001_initial.sql` in the SQL Editor, or use `npx supabase db push` if you use the CLI.

**Storage buckets (recommended):**

| Bucket | Purpose |
|--------|---------|
| `audio` | Private — raw recordings from the client |
| `exports` | Private — uploaded `export.json` / `export.txt` and signed URLs for `/complete` and `GET /api/interview/export` |

If `exports` is missing, **exports still succeed**: `POST /api/interview/export` returns file contents in the JSON body and the admin UI downloads locally. The `/complete` page primarily uses **signed URLs**; for a guaranteed copy without Storage, participants should use **Export during the interview** before leaving.

**Auth:** enable **Anonymous** sign-ins (Authentication → Providers → Anonymous).

### 4. Seed test data

```bash
npm run seed
```

Creates participant `TEST001` (and related rows per `scripts/seed.ts`).

### 5. Dev server

```bash
npm run dev
```

- Interview login: http://localhost:3000/login (try `TEST001`)
- Admin: http://localhost:3000/admin
- After login you are routed to an interview URL like `/interview/<uuid>`

---

## Interview lifecycle and APIs

### `POST /api/interview/create`

Ensures there is an **active** interview for the participant and an **opening turn**. It is **idempotent**: if an opening turn already exists for that session, the API responds with **409 Conflict** and the same payload shape as success so the client can hydrate the transcript without creating a duplicate interview.

### `POST /api/interview/turn`

Saves the participant turn, runs the **engine** (`lib/interview/engine.ts`): agenda update → strategic questions → next interviewer message, persists `agent_state` on the interview row, and returns the new turns plus `is_complete` when the session should end.

### `POST /api/interview/export` / `GET /api/interview/export`

- **POST** loads the full transcript from Postgres, builds JSON and plain text, returns **`json_content`** and **`txt_content`** in the response (always), and **optionally** uploads to the `exports` bucket and returns **`json_url`** / **`txt_url`** when Storage succeeds.
- **GET** reports whether a prior export row exists and refreshes signed URLs when paths are present.

---

## Interview protocol

The running protocol lives in **`lib/config/avp-protocol.json`**. It is organized as **topics** (ordered sections), each with a tree of probes:

- **`sub1`** — main questions  
- **`sub2`** — follow-ups (children of sub1)  
- **`sub3`** — deeper probes where needed  

Question text can include conditional cues (e.g. `[IF APPLICABLE]`, `[PROBE ONLY IF NECESSARY]`); the interviewer prompt in `lib/prompts/interviewer.ts` tells the model how to respect those.

**Current topics (11):** Life History; Family; Work; Neighborhoods and Social Groups; Finances — Expenses; Finances — Savings and Debt; Finances — Resources Beyond Employment; Health and Health Care; Politics and Current Events; Technology; Conclusion.

To run a different study: edit the JSON (or add another file), then point the turn route at it (`app/api/interview/turn/route.ts` imports this file today).

---

## Exports

### Plain-text shape

Both server-generated TXT and the **in-interview** download use the same general idea: header lines (study ID, interview ID, export time), then blocks per turn:

- Speaker label (`INTERVIEWER` / `PARTICIPANT`)
- Timestamp when available (`timestamp_start` on each turn)
- Full message text

Plain-text exports use the same general layout: a titled header (currently **"QUALITATIVE INTERVIEW TRANSCRIPT"** in both server and in-app downloads), study and interview identifiers, export time, then each turn with speaker label and timestamp when available.

### JSON shape (`InterviewExportPayload`)

See `lib/types/index.ts` — `participant_id`, `study_id`, `interview_id`, `mode`, timestamps, `completed`, optional `audio_url`, `transcript[]` with `turn_index`, `speaker`, `text`, `timestamp_start` / `timestamp_end`, and `metadata` (`exported_at`, `total_turns`, `version`).

---

## Vercel deployment

1. Push the repo to GitHub.
2. Import in [Vercel](https://vercel.com/new) as a Next.js project.
3. Add the same env vars as production (including `NEXT_PUBLIC_APP_URL` for your deployment URL if you use it). **Don't forget the optional TTS / AWS keys** — they are NOT auto-copied from your local `.env`:
   - `OPENAI_TTS_API_KEY` (+ `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` if customised) — without this the AI uses the browser's built-in `SpeechSynthesis` voice on the deployed site, and **the voice selector in the header will have no effect** (a small "fallback voice" badge appears next to it as a hint).
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_TRANSCRIBE_BUCKET` — without these the app falls back to Web Speech for transcription.

Serverless functions default to a **10s** timeout on the Hobby plan; LLM calls in `/api/interview/turn` can exceed that. Consider Pro (longer limit), a faster model, or moving generation to a background worker for heavy use.

---

## Changing the LLM

All chat completions go through `lib/llm/generateNextQuestion.ts`. Point `OPENAI_BASE_URL` and `OPENAI_MODEL` at any OpenAI-compatible server; no code changes required for typical provider swaps.

---

## AWS Transcribe (future)

Audio is stored as files in Supabase Storage. A stub lives in `lib/transcribe/index.ts`. When you wire Transcribe, extend `app/api/audio/upload/route.ts` per the comments in that stub.

---

## Running a quick self-test

1. `npm run seed` and `npm run dev`
2. Open `/login`, enter `TEST001`, complete **Begin Interview** and a few turns (voice and/or keyboard)
3. Use the **download** control in the interview footer to verify TXT export
4. Open `/admin`, confirm the participant and interview, click **Export** for `.txt` + `.json`
5. Inspect transcript structure against your study’s coding or memo needs

---

## Citation

If referencing SparkMe’s architecture in publications:

```bibtex
@article{anugraha2026sparkme,
  title={SparkMe: Adaptive Semi-Structured Interviewing for Qualitative Insight Discovery},
  author={Anugraha, David and Padmakumar, Vishakh and Yang, Diyi},
  journal={arXiv preprint arXiv:2602.21136},
  year={2026}
}
```
