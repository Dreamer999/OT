# OT — Omni-Transcribe

> Capture audio from your **Google Pixel Watch** or **Pixel phone** (via the Google Recorder app), auto-upload to your server, transcribe, and analyze with an LLM. One dashboard, searchable archive, no Otter subscription.

- [`PRD.md`](./PRD.md) — product requirements
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system architecture, cross-checked against the PRD

## What this repo ships

A working end-to-end demo:

- **Backend** — Node 20 + Express + SQLite (FTS5 for search). Pluggable transcription (OpenAI Whisper / mock) and analysis (Claude Haiku 4.5 / mock). Runs with **no API keys** in mock mode so you can try the full flow immediately.
- **Frontend** — installable PWA. Record in the browser, or upload a file, or share an audio file **from the Google Recorder app** directly into OT via the PWA share target.
- **Deploy configs** — `render.yaml`, `Dockerfile`, `docker-compose.yml`.

## 60-second local run

```bash
npm install
npm start
# → server prints a bootstrap bearer token, also written to data/initial-token.txt
```

Open http://localhost:3000 → **Settings** → paste the token → **Save**.

Now you can:
1. Click **● Record** and talk. On stop, the file uploads.
2. Or **Upload** an existing `.m4a` / `.mp3` / `.wav`.
3. Watch the status go `queued → transcribing → transcribed → analyzing → analyzed`.
4. Click the item to see summary, action items, decisions, transcript, audio playback.

Mock providers produce a deterministic transcript + analysis so the UI is fully exercised without credentials.

## Turn on real transcription / analysis

Copy `.env.example` → `.env` and set:

```
TRANSCRIPTION_PROVIDER=openai
OPENAI_API_KEY=sk-...

ANALYSIS_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

Restart. Done — real Whisper + Claude.

## Getting a public URL (so your Pixel can reach it)

Pick one:

### Render (simplest, ~$7/mo for the persistent disk)

1. Push this repo to GitHub.
2. In Render → **New → Blueprint** → point at the repo. `render.yaml` does the rest.
3. After it boots, open **Logs** and copy the printed bootstrap token (or SSH and `cat /opt/render/project/src/data/initial-token.txt`).
4. Open the URL Render gave you, paste the token in Settings.

### Self-host with Docker

```bash
docker compose up -d
```

Front it with Caddy / Cloudflare Tunnel for HTTPS, which is required for the PWA to install on Android.

### Cloudflare Tunnel (free, no server)

```bash
cloudflared tunnel --url http://localhost:3000
```

You'll get a `*.trycloudflare.com` URL that works end-to-end (PWA install, share target, microphone) while your laptop is on.

## Using it from your Pixel

1. Open your OT URL in Chrome on the Pixel.
2. Chrome menu → **Install app** (or **Add to Home screen**).
3. Open Google Recorder → record → stop → ⋯ → **Share** → **OT** appears in the share sheet.
4. The file uploads; you'll see it appear on the dashboard within seconds.
5. Watch recordings flow via the phone automatically (Pixel Watch syncs to the Recorder app).

## API

All endpoints require `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/recordings` | multipart `audio` → `{ id, status }` |
| GET | `/api/recordings?q=` | list (optional full-text) |
| GET | `/api/recordings/:id` | detail (recording + transcript + analysis) |
| GET | `/api/recordings/:id/audio` | stream audio |
| DELETE | `/api/recordings/:id` | soft delete |

Health: `/healthz`, `/readyz`.

## Project layout

```
server/src/
  index.js             # Express app, static hosting, route wiring
  config.js            # env → config
  db.js                # SQLite schema + migrations
  auth.js              # argon2 PAT auth, first-run bootstrap
  worker.js            # in-proc pipeline: transcribe → analyze
  events.js            # SSE fan-out (future use)
  providers/
    transcription.js   # Mock | OpenAI Whisper
    analysis.js        # Mock | Anthropic (Claude Haiku 4.5)
  routes/
    recordings.js
    share.js           # receives PWA share_target POST, hands off to SPA
public/
  index.html, app.js, styles.css
  manifest.webmanifest # share_target registration
  sw.js                # PWA service worker
  icons/*.svg
```

## Cost model (personal, ~30 min audio/day)

~$13–14 / month (Render $7 + Whisper $5.4 + Claude ~$0.5 + R2 + SES). See [PRD §10](./PRD.md#10-roi--cost-model). Swap Whisper → Deepgram Nova or self-hosted whisper.cpp to cut ~40%.

## Roadmap

- v1.1 — resumable uploads (tus), speaker diarization (Deepgram), Google Drive watcher
- v2 — Android companion app, email digests, webhooks (Notion / Todoist)

## License

MIT.
