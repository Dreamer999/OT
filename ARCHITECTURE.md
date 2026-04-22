# System Architecture — OT (Omni‑Transcribe)

Cross‑checked against `PRD.md` v0.1. Every requirement in the PRD maps to a component here (see §7 Traceability).

## 1. Context Diagram

```
                ┌──────────────────┐         ┌────────────────┐
  Pixel Watch ──►  Google Recorder │──sync──►│  Pixel Phone   │
                └──────────────────┘         │ Google Recorder│
                                             └──────┬─────────┘
                                                    │ Share sheet
                                                    ▼
                     ┌────────────────────────────────────────────┐
                     │  OT PWA (installed via manifest share tgt) │
                     └──────────────────────┬─────────────────────┘
                                            │ HTTPS multipart
                                            ▼
 ┌────────────────────────────────────────────────────────────────────┐
 │                     OT API (Node + Express)                         │
 │  ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌───────────────┐     │
 │  │ Ingest  │──►│  Queue   │──►│Transcribe│──►│   Analyze     │     │
 │  │ /upload │   │ (in-proc │   │ (Whisper │   │ (Claude Haiku)│     │
 │  └─────────┘   │  worker) │   │  or mock)│   └──────┬────────┘     │
 │                └──────────┘   └──────────┘          │              │
 │                                                      ▼              │
 │  ┌──────────────┐   ┌──────────────────┐   ┌───────────────┐       │
 │  │  SQLite +    │   │ Object storage   │   │  Email (SES)  │       │
 │  │   FTS5       │   │  (local / R2)    │   │   digest      │       │
 │  └──────────────┘   └──────────────────┘   └───────────────┘       │
 └────────────────────────────────────────────────────────────────────┘
                                            ▲
                                            │ JSON
                     ┌──────────────────────┴──────────────────────┐
                     │ Web dashboard (static SPA served by API)    │
                     └─────────────────────────────────────────────┘
```

## 2. Components

### 2.1 Client — PWA
- Single static bundle served by the API (`/public`).
- `manifest.webmanifest` registers **share_target** with `method: POST`, `enctype: multipart/form-data`, `params.files: [{ name: "audio", accept: ["audio/*"] }]`. On Pixel, Recorder's share sheet then lists "OT Upload".
- Service worker caches shell + handles offline queueing of uploads (retry when back online).
- Also provides an in‑browser recorder (MediaRecorder API) for demo / desktop use.

### 2.2 API — Node.js 20 + Express
- `POST /api/recordings` — auth'd multipart upload, writes file to storage, creates `recording` row (status=`queued`), enqueues job, returns id.
- `GET /api/recordings` — list.
- `GET /api/recordings/:id` — detail (joins transcript + analysis).
- `GET /api/recordings/:id/audio` — range‑request streaming.
- `DELETE /api/recordings/:id` — soft delete.
- `POST /api/auth/token` — demo endpoint that mints a PAT (v1: single‑user, seed on first boot).

### 2.3 Worker — in‑process (v1)
- A simple `setImmediate` queue that drains jobs serially. Upgrade path: swap to **BullMQ + Redis** without changing call sites.
- Stages:
  1. `transcribe(recordingId)` → writes rows to `transcript_segments`, sets status=`transcribed`.
  2. `analyze(recordingId)` → writes to `analyses`, sets status=`analyzed`.
  3. `notify(recordingId)` → optional email digest.

### 2.4 Transcription Provider (pluggable)
`TranscriptionProvider` interface with three implementations:
- `MockProvider` — deterministic canned transcript, used when no API keys set. **Demo runs end‑to‑end without credentials.**
- `OpenAIWhisperProvider` — `audio.transcriptions.create` with `whisper-1`, timestamps=`word`.
- `DeepgramProvider` — for diarization (v1.1).

Selected via env `TRANSCRIPTION_PROVIDER=mock|openai|deepgram`.

### 2.5 Analysis Provider
`AnalysisProvider` interface:
- `MockAnalysis` — canned JSON.
- `AnthropicAnalysis` — Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) with a structured‑output prompt returning `{ summary, action_items[], decisions[], topics[], sentiment }`. Uses prompt caching on the system prompt.

Selected via `ANALYSIS_PROVIDER=mock|anthropic`.

### 2.6 Storage
- **Metadata:** SQLite via `better-sqlite3` (single file, simple, fast enough for personal scale). FTS5 virtual table on transcripts for search.
- **Audio blobs:** local `./data/audio/` in dev; S3/R2 in prod (toggle via `STORAGE_DRIVER`).
- **Schema (essentials):**
  ```sql
  CREATE TABLE recordings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    filename TEXT, mime TEXT, bytes INTEGER, duration_s REAL,
    status TEXT CHECK (status IN ('queued','transcribing','transcribed','analyzing','analyzed','failed')),
    created_at INTEGER, updated_at INTEGER,
    error TEXT
  );
  CREATE TABLE transcripts (
    recording_id TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE,
    text TEXT, language TEXT, provider TEXT, raw_json TEXT
  );
  CREATE VIRTUAL TABLE transcripts_fts USING fts5(text, content='transcripts', content_rowid='rowid');
  CREATE TABLE analyses (
    recording_id TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE,
    summary TEXT, action_items_json TEXT, decisions_json TEXT,
    topics_json TEXT, sentiment TEXT, provider TEXT, raw_json TEXT
  );
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, created_at INTEGER);
  CREATE TABLE tokens (
    id TEXT PRIMARY KEY, user_id TEXT, hash TEXT, name TEXT, created_at INTEGER, last_used_at INTEGER
  );
  ```

### 2.7 Auth
- Single‑user bootstrap: on first run, server prints a PAT to stdout (and to `./data/initial-token.txt`). User pastes it into Settings in the PWA; it's stored in `localStorage` and sent as `Authorization: Bearer ...`.
- PATs hashed with argon2 before storage.

## 3. Sequence — "recording to dashboard"

```
Watch  Phone       PWA              API            Worker       Providers
  │      │          │                │               │              │
  │stop──▶(auto     │                │               │              │
  │      │ sync)    │                │               │              │
  │      │──share──▶│                │               │              │
  │      │          │──POST /recs───▶│               │              │
  │      │          │                │─enqueue──────▶│              │
  │      │          │◀─202 {id}──────│               │              │
  │      │          │                │               │─transcribe──▶│
  │      │          │                │               │◀─segments────│
  │      │          │                │               │─analyze─────▶│
  │      │          │                │               │◀─json────────│
  │      │          │                │◀──status=done─│              │
  │      │          │◀─SSE /events───│               │              │
```
(SSE on `/api/events` pushes status updates so the UI doesn't poll; polling is the fallback.)

## 4. Deployment Options

| Target | Pros | Cons | How |
|---|---|---|---|
| **Render** (recommended) | 1‑click, free SSL, persistent disk | $7/mo Starter for persistent disk | `render.yaml` included; click "Deploy to Render" |
| Fly.io | Global edge, generous free tier | Volumes need config | `fly.toml` |
| Railway | Dead simple Postgres later | Paid | Nixpacks autodetect |
| Self‑host (Pi/NAS) | Zero marginal cost, max privacy | You run it | `docker compose up` |
| Vercel | Free | No long‑running workers, no disk | Not suitable for v1 |

Decision: Render for demo link, documented `docker compose` for self‑host.

## 5. Observability
- `pino` structured logs.
- `/healthz` and `/readyz`.
- Request ID on every log line.
- Per‑job timings emitted so we can compute the PRD's P95 ≤ 90 s target.

## 6. Security
- HTTPS enforced (Render does this); HSTS on.
- CORS locked to the PWA origin.
- Multipart size cap = 500 MB (matches PRD).
- Rate limit: 60 req/min/token on ingest (prevents runaway).
- Audio URLs are signed + time‑boxed when served from object storage.
- SQLCipher optional via env flag.
- No third‑party analytics.

## 7. PRD Traceability

| PRD § | Requirement | Component |
|---|---|---|
| 5 Path A | Share target on Pixel | §2.1 PWA manifest `share_target` |
| 6.1 | `POST /api/recordings`, 500 MB, audio/* | §2.2 API + middleware |
| 6.2 | Queue → transcribe → analyze → notify | §2.3 Worker, §2.4, §2.5 |
| 6.3 | Dashboard / detail / settings / PWA install | §2.1 |
| 6.4 | Per‑user, encrypted at rest, soft delete | §2.6, §6 |
| 7 P95 ≤ 90 s | pipeline timings | §5 metrics |
| 7 99% uptime | single‑region OK | §4 Render |
| 9 Google tightens share | fallback paths | §2.1 also supports Drive watcher behind flag |
| 10 Cost ~$13/mo | Whisper + Haiku + Render + R2 | §2.4, §2.5, §4, §2.6 |

All v1 PRD requirements are covered. Gaps called out as v1.1/v2:
- Resumable uploads (tus) — **v1.1**
- Speaker diarization — **v1.1** with Deepgram
- Drive watcher — **v1.1** behind flag
- Android companion — **v2**
