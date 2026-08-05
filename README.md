# vibe-usage-local-server

Fully-local replacement server for the vibe-usage ingestion/dashboard API. Part of making the
vibe-usage stack (CLI + macOS app) work **completely locally** — no uploads to vibecafe.ai, with
locally tunable model pricing.

- **Node.js ≥20, zero runtime dependencies.**
- Receives token usage from the `@vibe-cafe/vibe-usage` CLI and serves it back to the Mac app dashboard.
- Prices (`estimatedCost`) are computed at **read time** from a local editable price table, so editing prices
  applies to existing data instantly (no re-sync).
- Data stored as JSON in `~/.vibe-usage-server/data.json`. Never leaves this machine.

---

## Architecture

```
本機工具日誌 (claude / codex / opencode …)
   │  ① ② CLI 解析 + 上傳   (CLI, 本機)
   ▼
vibe-usage-local-server  ◀── ③ 讀回  ────  macOS App dashboard
   │  (本 repo, launchd 長駐, port 3456)
   ▼
~/.vibe-usage-server/data.json   (本機 SQLite-可替代之 JSON 儲存)
```

The CLI and Mac app both read `apiUrl` from `~/.vibe-usage/config.json` (and `config.dev.json` for DEBUG
builds). Pointing that at `http://127.0.0.1:3456` sends all traffic to this local server instead of
`https://vibecafe.ai` — **no source changes to the CLI or app are required.**

### Endpoints

| Endpoint | Purpose | Required |
|----------|---------|----------|
| `POST /api/usage/ingest` | Receive buckets+sessions (gzip, Bearer auth, upsert dedup) | ✅ |
| `GET /api/usage` | Return filtered buckets (`days`/`from`/`to`/`tz`) | ✅ |
| `GET /api/usage/settings` | Return `{ uploadProject: true }` (CLI fetches before sync) | ✅ |
| `DELETE /api/usage/ingest` | Reset (optionally `?hostname=`) | optional |
| `POST /api/usage/device/code` + `/poll` | Not supported — use `--manual-key` | — |

### File layout

```
vibe-usage-local-server/
├── index.js              # entry point (node index.js)
├── src/
│   ├── server.js         # HTTP server + routing + auth + gzip + filtering
│   ├── store.js          # JSON persistence, bucket/session dedup
│   ├── prices.js         # price table loading + cost computation
│   └── prices.json       # ★ YOUR local price table (edit freely)
└── test/
    └── server.test.js    # node:test suite (8 tests)
```

---

## Quickstart

```bash
# 1. Start the server manually (or rely on launchd — see below)
node index.js
#   Vibe Usage local server listening on http://127.0.0.1:3456

# 2. Point CLI at the server
npx @vibe-cafe/vibe-usage init --manual-key vbu_xxx
#    ensure ~/.vibe-usage/config.json has:
#    { "apiKey": "vbu_xxx", "apiUrl": "http://127.0.0.1:3456" }

# 3. Sync (ingests into local server)
VIBE_USAGE_API_URL=http://127.0.0.1:3456 npx @vibe-cafe/vibe-usage sync
```

### The Mac app

Set `apiUrl` in **both** config files (release app reads `config.json`, DEBUG app reads `config.dev.json`):

```bash
# ~/.vibe-usage/config.json  and  ~/.vibe-usage/config.dev.json
{ "apiKey": "vbu_xxx", "apiUrl": "http://127.0.0.1:3456" }
```

Then **fully quit and reopen the app** — it reads the config at launch. Open the popover to fetch:
verified via server logs:

```
GET /api/usage?days=1&tz=Asia/Taipei -> 200  [ua=VibeUsage CFNetwork/...]
POST /api/usage/ingest -> 200                (app-driven CLI sync)
```

---

## Launchd (auto-start on login)

The server is managed as a user **LaunchAgent** so it starts at login and auto-restarts if it crashes.

Plist: `~/Library/LaunchAgents/com.vibe-usage.local-server.plist`
Logs: `~/.vibe-usage-server/server.log` / `server.err`

```bash
# load / start
launchctl load ~/Library/LaunchAgents/com.vibe-usage.local-server.plist

# stop the server (job kept, won't restart unless KeepAlive)
launchctl kickstart -k gui/$(id -u)/com.vibe-usage.local-server

# fully disable (won't start on future logins)
launchctl disable gui/$(id -u)/com.vibe-usage.local-server

# re-enable
launchctl enable gui/$(id -u)/com.vibe-usage.local-server
launchctl load ~/Library/LaunchAgents/com.vibe-usage.local-server.plist

# after editing the plist (e.g. changing PORT), reload:
launchctl unload ~/Library/LaunchAgents/com.vibe-usage.local-server.plist
launchctl load   ~/Library/LaunchAgents/com.vibe-usage.local-server.plist

# after editing server.js, restart:
launchctl kickstart -k gui/$(id -u)/com.vibe-usage.local-server
```

### Request logging (debug)

The server can log every request it receives (useful to confirm the app/CLI are hitting it):

```bash
# temporarily, in the plist EnvironmentVariables add:
#   <key>VIBE_USAGE_LOG_REQUESTS</key><string>1</string>
# or run manually:
VIBE_USAGE_LOG_REQUESTS=1 node index.js
```

### Sync timing note

Sync cadence is **app-driven** (the app's `SyncScheduler` runs every **30 minutes**, plus on popover open).
This launchd job only keeps the **server** alive — it does not change sync timing. With `apiUrl` pointed at
localhost, the pre-existing `ai.vibecafe.vibe-usage` CLI daemon also syncs to this server automatically.

---

## Local pricing (本地調價)

`estimatedCost` is computed at **read time** from `src/prices.json`, keyed by the exact `model` string the
CLI emits (which already encodes the provider, e.g. `accounts/fireworks/models/glm-5p2`,
`zai-org/GLM-5.2`). **Edit `src/prices.json` and costs update immediately across all existing data.**

```jsonc
{
  "models": {
    "accounts/fireworks/models/glm-5p2": {
      "input": 1.40, "output": 4.40, "cacheReadMtok": 0.14,
      "vendor": "fireworks", "source": "official"
    },
    "zai-org/GLM-5.2": {
      "input": 0.75, "output": 2.40, "cacheReadMtok": 0.14,
      "vendor": "deepinfra", "source": "official"
    }
  }
}
```

- `input` / `output` / `cacheReadMtok` = USD per **1 million** tokens.
- `vendor` / `source` = documentation only, not used in cost math.
- A model **absent** from the table → `estimatedCost` is `null` (matches the upstream contract where an
  unmatched model yields nil).
- Pricing sources: `official` = verified against the provider's published price (Fireworks
  `serverless/pricing.md`, DeepInfra `/v1/models` metadata, OpenAI, DeepSeek, Kimi, MiniMax);
  `openrouter` = pulled from OpenRouter `/api/v1/models`, not yet vendor-verified.
- OpenCode Go is a **subscription** (首月 $5 / 之後每月 $10); its models are intentionally priced at
  vendor per-token *estimate* so the cost column reflects usage value, not actual subscription billing.

---

## Storage

- **Path:** `~/.vibe-usage-server/data.json` (override dir via `VIBE_USAGE_SERVER_DIR`).
- **Buckets:** deduped by `source|model|project|hostname|bucketStart`; larger existing snapshot wins
  ("protected", matching upstream).
- **Sessions:** deduped by `source|sessionHash`.
- Writes are atomic (write temp + rename).

---

## Tests

```bash
node --test "test/*.test.js"     # 8 tests: pricing, dedup, auth, filtering, delete
```

---

## Rollback (back to vibecafe.ai)

```bash
# restore the pre-switch config (created when this was set up)
mv ~/.vibe-usage/config.json.bak-local-* ~/.vibe-usage/config.json   # pick the newest *.bak-local-*
# stop the local server
launchctl disable gui/$(id -u)/com.vibe-usage.local-server
```

---

## Config/credentials backup

`~/.vibe-usage/config.json` holds the real API key (0600). Backups are written alongside as
`config.json.bak-local-<timestamp>` before switching. Never commit keys.
