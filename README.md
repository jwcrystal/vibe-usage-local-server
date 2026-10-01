# vibe-usage-local-server

English | [繁體中文](README.zh-TW.md)

> **Canonical version: 繁體中文** ([README.zh-TW.md](README.zh-TW.md)) — this
> English README tracks it; when they diverge, the Chinese one wins.

A fully-local reimplementation of vibe-usage's data-ingest and dashboard API,
so the entire vibe-usage stack (CLI + macOS app) runs **cloud-free** — nothing
is uploaded to vibecafe.ai, and the model price table is yours to edit.

- **Node.js ≥ 20, zero runtime dependencies**
- Ingests token usage from the `@vibe-cafe/vibe-usage` CLI and serves it back to the Mac app dashboard
- Costs (`estimatedCost`) are computed **at read time** from a locally editable price table — change a price and all existing data updates instantly, no re-sync needed
- Data lives in `~/.vibe-usage-server/data.json` and **never leaves your machine**

---

## Contents

- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Web dashboard](#web-dashboard)
- [Connecting the macOS app](#connecting-the-macos-app)
- [Local pricing](#local-pricing)
- [Storage](#storage)
- [Tests](#tests)
- [Auto-start (launchd)](#auto-start-launchd)
- [Debugging & rollback](#debugging--rollback)
- [Future storage + query work](#future-storage--query-work)

---

## Architecture

```
Local tool logs (claude / codex / opencode …)
   │  ① ② parse + upload   (CLI, local)
   ▼
vibe-usage-local-server  ◀── ③ read back ────  macOS App dashboard
   │  (this repo, launchd daemon, port 3456)
   ▼
~/.vibe-usage-server/data.json   (local JSON storage)
```

Both the CLI and the Mac app read `apiUrl` from `~/.vibe-usage/config.json`
(DEBUG builds read `config.dev.json` instead). Point it at
`http://127.0.0.1:3456` and all traffic goes to the local server — **no CLI or
app source changes required**.

### API endpoints

| Endpoint | Purpose | Support |
|----------|---------|---------|
| `POST /api/usage/ingest` | Receive buckets+sessions (gzip, Bearer auth, upsert dedup) | ✅ |
| `GET /api/usage` | Return filtered buckets (`days`/`from`/`to`/`tz`) + `unpricedModels` (models missing from the price table) | ✅ |
| `GET /api/usage/settings` | Returns `{ uploadProject: true }` (the CLI fetches it before syncing) | ✅ |
| `DELETE /api/usage/ingest` | Reset (optional `?hostname=`) | optional |
| `POST /api/usage/device/code` + `/poll` | Not supported — use `--manual-key` | — |

### Project structure

```
vibe-usage-local-server/
├── index.js               # entry point + npm bin (node index.js / vibe-usage-server)
├── src/
│   ├── server.js         # HTTP server, routing, auth, gzip, filtering
│   ├── store.js          # JSON persistence, bucket/session dedup
│   ├── prices.js         # price table loading & cost math
│   ├── prices.json       # ★ your local price table (edit freely)
│   └── ui/
│       └── dashboard.html # single-file web dashboard (zero deps)
├── scripts/
│   ├── com.vibe-usage.server.plist # launchd LaunchAgent template
│   ├── install-launchd.sh           # install + start (login autostart, crash restart)
│   └── uninstall-launchd.sh         # remove
└── test/
    └── server.test.js    # node:test suite (11 tests)
```

---

## Quick start

```bash
# 0. (optional) install globally via npm — then just run `vibe-usage-server`
npm pack && npm install -g ./vibe-usage-local-server-0.1.1.tgz

# 1. Start the server (manually, or use launchd below)
node index.js          # or with a global install: vibe-usage-server
#   Vibe Usage local server listening on http://127.0.0.1:3456

# 2. Point the CLI at the server
npx @vibe-cafe/vibe-usage init --manual-key vbu_xxx
#    confirm ~/.vibe-usage/config.json ends up as:
#    { "apiKey": "vbu_xxx", "apiUrl": "http://127.0.0.1:3456" }

# 3. Sync (writes into the local server)
VIBE_USAGE_API_URL=http://127.0.0.1:3456 npx @vibe-cafe/vibe-usage sync
```

> Packaging: `npm pack` produces `vibe-usage-local-server-<version>.tgz`
> containing pure Node source (`src/`, `ui/`, `index.js`) — zero dependencies;
> `npm install` on any platform (Node ≥ 20) just works.

### Proper install (npm global) + custom data directory

If you'd rather not run from a checkout, install globally and use
`vibe-usage-server` directly. Data and prices default to
`~/.vibe-usage-server/`; point `VIBE_USAGE_SERVER_DIR` at a custom directory
to keep data, prices, and logs together:

```bash
# 1. Install
npm install -g vibe-usage-local-server   # or from a local tgz: npm install -g ./vibe-usage-local-server-0.1.1.tgz

# 2. Create a custom data directory (optional; defaults to ~/.vibe-usage-server/)
mkdir -p /Volumes/Data/vibe-usage

# 3. Start (VIBE_USAGE_SERVER_DIR sets the data dir; it locates both data.json and prices.json)
VIBE_USAGE_SERVER_DIR=/Volumes/Data/vibe-usage vibe-usage-server
#   Vibe Usage local server listening on http://127.0.0.1:3456
#   Data: /Volumes/Data/vibe-usage/data.json

# 4. Point the CLI at the server
npx @vibe-cafe/vibe-usage init --manual-key vbu_xxx
#    confirm ~/.vibe-usage/config.json ends up as:
#    { "apiKey": "vbu_xxx", "apiUrl": "http://127.0.0.1:3456" }

# 5. Sync (with the same VIBE_USAGE_SERVER_DIR as step 3, so the CLI writes into the same dir)
VIBE_USAGE_SERVER_DIR=/Volumes/Data/vibe-usage \
VIBE_USAGE_API_URL=http://127.0.0.1:3456 \
npx @vibe-cafe/vibe-usage sync
```

> **`VIBE_USAGE_SERVER_DIR` locates both `data.json` and `prices.json`** — drop
> a `prices.json` in that directory to override the built-in table (see
> [Local pricing](#local-pricing)).
> Note: for the server and CLI to share one data directory, set the same
> `VIBE_USAGE_SERVER_DIR` for both.

---

## Web dashboard

The server serves a **zero-dependency, single-file** dark dashboard at
**`http://127.0.0.1:3456/`** (or `/usage`):

- **11 KPI cards** (cost / total / input / output / cache-read / cache-write tokens, active / total duration, session count, total / user messages), each with **% change vs the previous equal-length period**
- **Usage trends**: stacked token chart (output / input / cache) that auto-switches hourly/daily granularity by range, switchable between cost / output / input / cache
- **Activity heatmap** (7×24)
- **Distribution donuts**: model / tool / project / terminal (token / cost toggle)
- **Detail table**: sortable, terminal column masked by default with a one-click reveal; the header's **export menu** offers a **detail CSV** (raw values, UTF-8 BOM, spreadsheet formula-injection guard, terminal column follows the mask toggle) or a **single-page HTML report** (KPI overview + model/tool/project breakdown tables, self-contained and print-to-PDF ready) — both respect the current range, filters, and sort
- **Time ranges**: today / 24H / 7D / 30D / 90D / custom — each re-queries `GET /api/usage`
- **Dimension filters**: tool / model / project / terminal

Staggered fade-in on load, card/donut hover lift, bar and heatmap-cell hover
emphasis, table row highlight, and tooltips throughout. Chart bars use
**pixel heights** (not CSS `%`) so they never overflow into full-column blocks
under flex or browser quirks.

All day/hour bucketing and session-range filtering use the **browser's local
timezone**, so day boundaries group correctly (e.g. early morning in
Asia/Taipei). The original UTC-prefix behavior would mis-bucket them.

The server injects the expected API key into the page for `/api/usage` auth.
The server binds only to `127.0.0.1` by default, so the key doesn't leave the
machine. Any browser works — including machines without the Mac app
(Windows / Linux).

```bash
open http://127.0.0.1:3456/        # once the server is running
```

> Note: the server returns all sessions without day filtering (matching
> upstream); the dashboard filters them client-side by the selected range, so
> the Active / duration / message cards only count sessions within range.

---

## Connecting the macOS app

Set `apiUrl` in **both** config files (the release app reads `config.json`,
DEBUG builds read `config.dev.json`):

```bash
# ~/.vibe-usage/config.json and ~/.vibe-usage/config.dev.json
{ "apiKey": "vbu_xxx", "apiUrl": "http://127.0.0.1:3456" }
```

Then **fully quit and reopen the app** — it reads config at launch. Open the
popover to trigger a read; the server log confirms:

```
GET /api/usage?days=1&tz=Asia/Taipei -> 200  [ua=VibeUsage CFNetwork/...]
POST /api/usage/ingest -> 200                (app-driven CLI sync)
```

---

## Local pricing

`estimatedCost` is computed **at read time** from the price table, keyed by
the exact `model` string the CLI emits (the string already includes the
provider, e.g. `accounts/fireworks/models/glm-5p2`, `zai-org/GLM-5.2`).
**Change the table and every existing record's cost updates instantly.** The
built-in table covers the providers these tools emit, plus source-scoped price
tables for individual providers (see below).

### Where does prices.json go?

Override price tables are resolved in **priority order**; first hit wins:

| Priority | Path | Use case |
|----------|------|----------|
| 1 | `~/.vibe-usage-server/prices.json` (data dir, relocatable via `VIBE_USAGE_SERVER_DIR`) | **Recommended** — lives with user data, survives reinstalls |
| 2 | `src/prices.json` | Pure-Node-source development: edit the built-in default directly |

Checked in order at startup (data dir first); if neither exists or the file is
invalid (no `models` object), it falls back to the **embedded default table**
(`src/prices.json`).

> Node source (`node index.js`): besides the data-dir override, the built-in
> table is just `src/prices.json` — edit it directly while developing.

### Full customization example

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

### Source-scoped prices (`sources`)

The same `model` string can arrive from different CLIs. Command Code serves a
set of models from its own catalog, and a few of those ids collide with another
vendor's id at a different price (`gpt-5.6-sol` 5/30 on Command Code vs 4/20
elsewhere; `gpt-5.3-codex` 2/8 vs 1.75/14). Putting either price in `models`
misprices the other source.

`prices.json` accepts an optional **`sources`** block:
`sources.<source>.models` takes precedence over `models` for buckets from that
`source`, while every other source keeps the model-keyed lookup. The built-in
table ships **`sources.commandcode.models`** (the Command Code catalog).

```jsonc
{
  "models": {
    "gpt-5.6-sol": { "input": 4, "output": 20, "cacheReadMtok": 0.4, "vendor": "openai", "source": "official" }
  },
  "sources": {
    "commandcode": {
      "models": {
        "gpt-5.6-sol": { "input": 5, "output": 30, "cacheReadMtok": 0.5, "cacheWriteMtok": 6.25, "vendor": "openai", "source": "command-code-catalog" }
      }
    }
  }
}
```

> A data-dir override that does not define `sources` still gets the built-in
> `sources`; one that defines its own takes over.

### Field reference

- `input` / `output` / `cacheReadMtok` / `cacheWriteMtok` = USD per **1 million** tokens; all optional (missing = 0).
- Cost formula (`prices.js`): `input×inRate + (output + reasoningOutput)×outRate + cachedInput×cacheReadRate + cacheCreation5m×cacheWriteRate`.
- `cacheWriteMtok` prices cache **writes** (`cacheCreation5mTokens`, uploaded by the CLI's claude-code / opencode / codearts / droid parsers). Claude models are filled in at the official 5m rate (1.25× input); other vendors default to 0 until their cache-write billing is verified.
- `vendor` / `source` are documentation-only, **not used in cost math**.
- Models **absent** from the table → `estimatedCost` is `null` (matches upstream's "unmatched model yields nil").
- Price sources: `official` = verified against the provider's published prices (Anthropic, OpenAI, Google Gemini, Fireworks, DeepInfra, DeepSeek, Kimi, MiniMax); `openrouter` = taken from OpenRouter's `/api/v1/models`, not yet vendor-verified.
- OpenCode Go is **subscription-based** (first month $5 / $10 per month after); its models are deliberately priced as per-token *estimates* of vendor rates so the cost column reflects **actual usage value**, not your real subscription bill.

---

## Storage

- **Path**: `~/.vibe-usage-server/data.json`; the whole data directory can be
  relocated with `VIBE_USAGE_SERVER_DIR` (e.g.
  `VIBE_USAGE_SERVER_DIR=/Volumes/Data/vibe-usage` puts both `data.json` and
  `prices.json` there).
- **Buckets**: deduped by `source|model|project|hostname|bucketStart`; the
  larger existing snapshot wins ("protection", matching upstream).
- **Sessions**: deduped by `source|sessionHash`.

### Bucket field mapping (cache read/write)

The internal field names are the **wire protocol + on-disk format** (the CLI
parser upload contract, existing `data.json`, upstream compatibility) and are
kept for historical compatibility — if the upstream protocol ever renames
them or splits out a TTL dimension, migrate against this table:

| Concept | Internal field | UI label | CSV export | Provider terminology |
|---|---|---|---|---|
| Cache **read** | `cachedInputTokens` | 緩存讀 | `cache_read_tokens` | Anthropic `cache_read_input_tokens`; OpenAI `cached_tokens` |
| Cache **write** | `cacheCreation5mTokens` | 緩存寫 | `cache_write_tokens` | Anthropic `cache_creation_input_tokens` |

Notes:
- The `5m` in `cacheCreation5mTokens` is Anthropic naming legacy; the field
  actually holds each provider's **total cache write** (OpenCode's store has
  no per-TTL breakdown and routes everything here). Anthropic 1h-TTL writes
  currently **cannot** be represented.
- Direct OpenAI API usage does **not** report cache writes (implicit caching
  reports read hits only) — a zero here is expected, not a tooling gap;
  gateway-fronted setups (platforms that report write) are where nonzero
  values come from.
- Writes are atomic (write to a temp file, then rename).
- **Backup & recovery**: on the first read of each run, a healthy `data.json`
  is snapshotted to `data.json.bak`; if `data.json` is corrupt, the server
  falls back to `.bak` and preserves the bad file as `data.json.corrupt` for
  inspection.

---

## Tests

```bash
node --test "test/*.test.js"     # 11 tests: pricing, dedup, auth, filtering, delete, unpriced list, bind guard, backup recovery
```

---

## Auto-start (launchd)

The server runs as a user **LaunchAgent**: **starts at login** (`RunAtLoad`),
**restarts on crash** (`KeepAlive`).

Install with the bundled script (resolves the `vibe-usage-server` command
path, writes the plist, and starts it):

```bash
./scripts/install-launchd.sh
# if the command isn't on PATH: ./scripts/install-launchd.sh --bin /path/to/vibe-usage-server

# stop (job kept)
launchctl bootout gui/$(id -u)/com.vibe-usage.server

# fully disable (won't start at next login)
launchctl disable gui/$(id -u)/com.vibe-usage.server
launchctl enable gui/$(id -u)/com.vibe-usage.server   # re-enable

# remove the LaunchAgent
./scripts/uninstall-launchd.sh
```

Plist: `~/Library/LaunchAgents/com.vibe-usage.server.plist`
Logs: `~/.vibe-usage/logs/` (`vibe-usage-server.log` / `server.err`)
Log rotation: `install-launchd.sh` tries (needs sudo, non-interactive) to
install `/etc/newsyslog.d/com.vibe-usage.server.conf` — 1MB rotation, 3
compressed copies kept; without sudo it prints the manual command.
State: `launchctl print gui/$(id -u)/com.vibe-usage.server`

> To use a custom data dir under launchd, add
> `<key>VIBE_USAGE_SERVER_DIR</key><string>/Volumes/Data/vibe-usage</string>`
> to the plist's `EnvironmentVariables`, then
> `launchctl bootstrap gui/$(id -u) <plist>` to reload.

### Request logging (debugging)

Make the server log every request it receives (to confirm the app / CLI
really hits it):

```bash
# temporarily add to the plist's EnvironmentVariables:
#   <key>VIBE_USAGE_LOG_REQUESTS</key><string>1</string>
# or just run:
VIBE_USAGE_LOG_REQUESTS=1 node index.js
```

### Sync timing notes

Sync cadence is **app-driven** (the app's `SyncScheduler` fires every
**30 minutes**, plus on popover open). This launchd agent only keeps the
**server** alive; it doesn't change sync timing. When `apiUrl` points at
localhost, the existing `ai.vibecafe.vibe-usage` CLI daemon also syncs to
this server automatically.

---

## Debugging & rollback

**Back to vibecafe.ai**

```bash
# restore the pre-switch config (a backup was made at switch time)
mv ~/.vibe-usage/config.json.bak-local-* ~/.vibe-usage/config.json   # pick the newest *.bak-local-*
# stop the local server
launchctl bootout gui/$(id -u)/com.vibe-usage.server
```

**Config / credential backup**

`~/.vibe-usage/config.json` holds the real API key (0600). Before switching, a
`config.json.bak-local-<timestamp>` backup is written to the same directory.
**Never commit the key to version control.**

---

## Future storage + query work

> This section is a **decision memo**, not a backlog. Staying on JSON for now,
> because: measured **~2.6MB / 351 days / ~3.6 buckets/day** (1274 buckets +
> 6797 sessions), extrapolating to **~13MB over 5 years**. Full JSON load +
> atomic write-back takes **a few ms** at this scale — far below perception
> (sync only runs every 30 minutes). **SQLite offers no measurable advantage
> at this size.**

### Current query behavior

- `GET /api/usage` calls `loadData()` (`readFileSync` + `JSON.parse` of the
  **whole file**); buckets are filtered server-side by `days/from/to`, but
  **sessions are returned in full** and filtered client-side by the dashboard
  (for the Active / duration / message cards).
- At this data size, full-file parse + client-side filter are both
  imperceptible; "sessions not filtered server-side" **is not a bug**.

### When to optimize

Only enter optimization when one of these real pain points appears:

- `data.json` makes `loadData()` parse/serialize perceptibly slow (e.g. > 100ms, roughly **~100+MB**);
- dashboard views get visibly laggy from the full-session payload;
- multi-user or custom cross-time aggregation queries appear;
- finer-grained raw event streams need keeping (10–100× larger than buckets/sessions).

### Trade-offs between the two routes

| Route | Approach | Pros | Cost |
|-------|----------|------|------|
| **A. JSON sharding** | Split by time into smaller files (e.g. `data-2026-06.json`); queries parse only the needed months | Keeps **zero-dependency**; format stays CLI/app-compatible (full read-back, parse only the queried months); lives inside `store.js`, small blast radius | Needs shard write/read logic and multi-file management |
| **B. SQLite** | True partial reads via `WHERE bucketStart BETWEEN ...` | Native time-range queries, indexes, partial reads | Breaks zero-dependency; needs a native module (better-sqlite3) or Node 26+ built-in `node:sqlite` (conflicts with `engines: >=20`); storage format must align with the CLI/app; one-time data migration |

If that day comes, **prefer route A (JSON sharding)**: it fits this repo's
zero-dep / CLI-app-compatible philosophy better and can be done inside the
store layer without touching the API. **SQLite is only worth considering when
"fine-grained event streams + complex queries" arrive together.** Until then,
keep the status quo and let the data grow naturally.

---

## Acknowledgements

Inspired by [vibe-usage](https://github.com/vibe-cafe/vibe-usage) — this
project reimplements its ingest and dashboard API locally, and is directly
compatible with its CLI (`@vibe-cafe/vibe-usage`, MIT).

## License

MIT — see [LICENSE](LICENSE).
