# PRD — OT (Omni‑Transcribe)

**Owner:** dreamer999
**Status:** Draft v0.1
**Last updated:** 2026‑04‑22

---

## 1. Problem & Opportunity

Users want to capture audio from their **Google Pixel Watch** or **Pixel 8/9 Pro** (via the native Google **Recorder** app), automatically ship every recording to a personal server, transcribe it, and run LLM analysis (summary, action items, topics, sentiment).

Today the Recorder app already transcribes on‑device but:
- Recordings live only on the device / Google account.
- No automated pipeline for server‑side analysis.
- No searchable archive across devices.
- No way to fan‑out the transcript to downstream tools (Notion, calendars, CRMs).

**Opportunity:** a lightweight personal pipeline — "record on any Pixel, get transcript + insights on the web in < 60 s."

## 2. Goals / Non‑Goals

### Goals (v1)
1. Capture audio from Pixel Watch or Pixel phone and deliver the file to our server automatically after the recording stops.
2. Server transcribes the audio (word‑level timestamps, speaker labels if multi‑speaker).
3. LLM generates: TL;DR, action items, decisions, topics, sentiment, follow‑ups.
4. Web UI to browse, search, replay audio with aligned transcript, and share.
5. Single‑user auth, with a clean path to multi‑tenant later.

### Non‑Goals (v1)
- Real‑time streaming transcription (post‑recording upload is enough).
- Native app with custom recording UI — we piggy‑back on Google Recorder.
- Multi‑tenant billing, team workspaces, SSO.
- Mobile push notifications (email only for v1).

## 3. Users & Jobs‑to‑be‑Done

| User | JTBD |
|---|---|
| "Maker on the go" (primary, = you) | "When I mumble an idea into my watch, I want it captured, transcribed, and summarized on my dashboard without touching my phone." |
| Knowledge worker in meetings | "Record a 1:1 from my phone, get decisions + action items emailed to me in minutes." |
| Journalist / researcher | "Long‑form interviews are auto‑archived and searchable." |

## 4. User Stories

1. As a user, I long‑press Recorder on my Pixel Watch, talk, and when I stop it auto‑syncs to my server. *AC:* file appears in dashboard within 60 s of hitting stop (assuming Wi‑Fi).
2. As a user, I see a list of recordings with title, date, duration, status badge (Uploading → Transcribing → Analyzed).
3. As a user, I click a recording and see: audio player, synchronized transcript, summary panel, action‑item list, tags.
4. As a user, I can search full‑text across all my transcripts.
5. As a user, I can export a recording as Markdown / JSON.
6. As a user, I can delete a recording (soft delete, 30‑day retention).

## 5. Flow: How the recording actually gets from the Pixel to the server

Google does **not** expose a public API inside Recorder to auto‑upload. We have three realistic paths; v1 ships #A, #B is a nicety, #C is the upgrade path.

**Path A — Share Sheet + PWA (v1, zero‑approval):**
After finishing a recording in Recorder, tap the ⋯ menu → Share → select **"OT Upload"** (our PWA installed via the browser's "Install app" / registered as a share target via `share_target` in the web manifest). The PWA receives the audio file, uploads it to the API, done. Works on Pixel phone today. Watch → phone sync is already automatic for Recorder, so watch recordings flow through the phone.

**Path B — Google Drive watcher (optional):**
Recorder can back up to Drive. A server‑side cron polls a specific Drive folder via OAuth and ingests new files. Zero taps after setup, but requires Drive OAuth consent.

**Path C — Android companion app (v2):**
A minimal Android app registered as a share target or file observer on `Recordings/` directory, uploads to our API. Gives us a "one‑tap share" affordance and background reliability, but requires Play Store distribution.

Decision for v1: **Path A (PWA share target)** for immediate usability, with Path B wired behind a feature flag.

## 6. Functional Requirements

### 6.1 Ingestion API
- `POST /api/recordings` — multipart `audio/*`, returns `{ id, status: "queued" }`.
- Supports `.m4a`, `.mp3`, `.wav`, `.ogg`, `.webm`, `.aac`, up to 500 MB.
- Requires bearer token (per‑user long‑lived PAT).

### 6.2 Pipeline
- Queue job → **Transcribe** (Whisper / Gemini / Deepgram, configurable) → **Analyze** (Claude) → **Index** (SQLite FTS5 in v1) → **Notify** (email).
- Each stage updates a status row so the UI can show progress.
- Failures are retried with exponential backoff (max 3) and surfaced in the UI.

### 6.3 Web App
- `/` dashboard — list of recordings w/ filters.
- `/r/:id` detail — player + transcript + analysis tabs.
- `/settings` — API token, retention, provider choice.
- Install‑as‑PWA banner; share target registered.

### 6.4 Security / Privacy
- All audio & transcripts are per‑user, encrypted at rest (SQLCipher or provider‑native).
- HTTPS only; HSTS on.
- PAT stored hashed (argon2).
- Soft delete + 30‑day purge.
- No third‑party analytics on the audio domain.

## 7. Non‑Functional Requirements
- P95 end‑to‑end latency (upload end → analysis ready) ≤ 90 s for a 10‑minute recording.
- Dashboard TTI ≤ 2 s on 4G.
- 99% monthly availability (single‑region is acceptable for v1).
- Backups: nightly SQLite + object storage snapshot.

## 8. Metrics
- **Activation:** % of users with ≥ 1 completed recording within 24 h of signup. Target ≥ 80%.
- **Reliability:** pipeline success rate. Target ≥ 98%.
- **Engagement:** recordings/user/week.
- **Cost:** $ per analyzed minute (see §10).

## 9. Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Google tightens Recorder share permissions | Fall back to Drive watcher / companion app. |
| Transcription cost spikes | Cache, use Whisper‑open on cheap GPU tier or tiered pricing per minute. |
| Audio privacy concerns | Local‑only mode (self‑hosted backend, Whisper on‑box). |
| Large files on mobile networks | Chunked resumable upload (tus protocol) in v1.1. |

## 10. ROI / Cost Model

Assumptions: personal use ≈ **30 minutes of audio/day = 900 min/month**.

| Component | Provider (default) | Unit cost | Monthly |
|---|---|---|---|
| Transcription | OpenAI Whisper API | $0.006 / min | ~$5.40 |
| Analysis (Claude Haiku 4.5) | Anthropic | ~$0.80 in + $4 out per 1M tok; ~1k tok/recording ×90 recordings | ~$0.50 |
| Hosting | Render Web Service Starter | flat | $7 |
| Object storage (S3/R2) | Cloudflare R2 | ~$0.015/GB | ~$0.30 |
| Email (SES) | AWS | negligible | ~$0.10 |
| **Total** | | | **≈ $13–14 / month** |

Swap Whisper → Deepgram Nova ($0.0043/min) or self‑hosted whisper.cpp on CPU to cut cost ~40% if needed. Verdict: trivial for single‑user, clearly worth it. Break‑even vs. paid meeting‑notes SaaS (Otter Pro ≈ $17/mo, Fireflies ≈ $18/mo) is immediate.

## 11. Milestones
- **M0 (this PR):** PRD + architecture + runnable demo (web upload, mock/real transcribe, analyze, dashboard).
- **M1 (week 1):** PWA share target wired, deploy to Render, real Whisper + Claude.
- **M2 (week 2):** Search, export, email digests.
- **M3 (week 3):** Drive watcher, companion app spike.

## 12. Open Questions
- Which provider do we default to — Whisper, Gemini 2.5 (cheaper w/ audio input), or Deepgram? → Leaning Whisper for quality, Gemini as cost toggle.
- Do we want speaker diarization in v1? → Yes if the provider gives it free (Deepgram does).
- Where do we host? Render vs. Fly vs. self‑hosted Raspberry Pi at home? → Render for simplicity; doc the self‑host path.
