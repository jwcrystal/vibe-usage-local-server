# vibe-usage-local-server

在本地重現 vibe-usage 的資料接收與 dashboard API 的替代伺服器，讓整套 vibe-usage
（CLI + macOS App）**完全不依賴雲端運作**——不上傳至 vibecafe.ai，並可本地自行調整模型計價。

- **Node.js ≥ 20，零運行時依賴**
- 接收 `@vibe-cafe/vibe-usage` CLI 的 token 用量，再回傳給 Mac App dashboard
- 費用（`estimatedCost`）在**讀取時**依本地可編輯的價格表即時計算，改價格立即套用至既有資料，無需重新同步
- 資料以 JSON 存放於 `~/.vibe-usage-server/data.json`，**絕不離開本機**

---

## 目錄

- [架構](#架構)
- [快速開始](#快速開始)
- [Web dashboard](#web-dashboard)
- [macOS App 連線](#macos-app-連線)
- [本地計價](#本地計價)
- [儲存](#儲存)
- [測試](#測試)
- [自動啟動（launchd）](#自動啟動launchd)
- [除錯與回滾](#除錯與回滾)

---

## 架構

```
本機工具日誌 (claude / codex / opencode …)
   │  ① ② CLI 解析 + 上傳   (CLI, 本機)
   ▼
vibe-usage-local-server  ◀── ③ 讀回  ────  macOS App dashboard
   │  (本 repo, launchd 長駐, port 3456)
   ▼
~/.vibe-usage-server/data.json   (本機 JSON 儲存)
```

CLI 與 Mac App 都會從 `~/.vibe-usage/config.json`（DEBUG 版另讀 `config.dev.json`）讀取
`apiUrl`。把它指向 `http://127.0.0.1:3456`，所有流量便改送本地伺服器，**無需改動 CLI / App 原始碼**。

### API 端點

| Endpoint | 用途 | 必備 |
|----------|------|------|
| `POST /api/usage/ingest` | 接收 buckets+sessions（gzip、Bearer 認證、upsert 去重） | ✅ |
| `GET /api/usage` | 回傳過濾後的 buckets（`days`/`from`/`to`/`tz`） | ✅ |
| `GET /api/usage/settings` | 回傳 `{ uploadProject: true }`（CLI 同步前會先取） | ✅ |
| `DELETE /api/usage/ingest` | 重設（可加 `?hostname=`） | 選用 |
| `POST /api/usage/device/code` + `/poll` | 不支援 — 請用 `--manual-key` | — |

### 專案結構

```
vibe-usage-local-server/
├── index.js              # 進入點 (node index.js)
├── src/
│   ├── server.js         # HTTP server、路由、認證、gzip、過濾
│   ├── store.js          # JSON 持久化、bucket/session 去重
│   ├── prices.js         # 價格表載入與費用計算
│   ├── prices.json       # ★ 你的本地價格表（可自由編輯）
│   └── ui/
│       └── dashboard.html # 單檔 Web dashboard（零依賴）
└── test/
    └── server.test.js    # node:test 測試 (8 項)
```

---

## 快速開始

```bash
# 1. 啟動伺服器（手動，或改用 launchd，見下方）
node index.js
#   Vibe Usage local server listening on http://127.0.0.1:3456

# 2. 將 CLI 指到伺服器
npx @vibe-cafe/vibe-usage init --manual-key vbu_xxx
#    確認 ~/.vibe-usage/config.json 為：
#    { "apiKey": "vbu_xxx", "apiUrl": "http://127.0.0.1:3456" }

# 3. 同步（寫入本地伺服器）
VIBE_USAGE_API_URL=http://127.0.0.1:3456 npx @vibe-cafe/vibe-usage sync
```

---

## Web dashboard

伺服器在 **`http://127.0.0.1:3456/`**（或 `/usage`）提供一個**零依賴、單檔**的深色 dashboard：

- **10 張 KPI 卡**（費用 / 輸入 / 輸出 / 快取 token、活躍 / 總時長、會話數、總 / 用戶訊息數），各帶**與前一等長時段相比的 % 變化**
- **用量趨勢**：依選定時間範圍自動切換每小時 / 每日粒度的堆疊 token 圖（輸出 / 輸入 / 快取），並可切換 費用 / 輸出 / 輸入 / 快取 指標
- **分時活躍熱力圖**（7×24）
- **分布圓環圖**：模型 / 工具 / 項目 / 終端（Token / 費用 切換）
- **詳細記錄表**：可排序，終端欄預設遮蔽、可一鍵切換顯示
- **時間範圍**：今天 / 24H / 7D / 30D / 90D / 自定義，皆重新查詢 `GET /api/usage`
- **維度篩選**：工具 / 模型 / 項目 / 終端

互動效果：載入時錯落淡入、卡片 / 圓環 hover 浮起、長條與熱力格 hover 強調、表格列強調，外加指標 / 圖表 / 分布的樣式化 hover 提示。圖表長條一律用**像素高度**（非 CSS `%`），才不會在 flex 或瀏覽器怪異行為下溢位成整欄色塊。

所有日 / 時分桶與 session 範圍過濾都用**瀏覽器本地時區**，跨日邊界（如亞洲/台北的清晨）能正確分組。若沿用原始 UTC 前綴會分錯。

伺服器把期望的 API key 注入頁面，供瀏覽器對 `/api/usage` 認證。因為伺服器預設只綁定 `127.0.0.1`，key 不會外洩。任何瀏覽器都能執行，因此也適用於沒有 Mac App 的機器（Windows / Linux）。

```bash
open http://127.0.0.1:3456/        # 伺服器啟動後
```

> 註：伺服器回傳所有 sessions 不做日過濾（與上游一致）；dashboard 會在本地依選定範圍過濾，
> 讓 Active / 總時長 / 訊息卡只統計該範圍內的 session。

---

## macOS App 連線

在**兩個** config 檔都設定 `apiUrl`（正式版 App 讀 `config.json`，DEBUG 版讀 `config.dev.json`）：

```bash
# ~/.vibe-usage/config.json 與 ~/.vibe-usage/config.dev.json
{ "apiKey": "vbu_xxx", "apiUrl": "http://127.0.0.1:3456" }
```

然後**完全結束並重開 App**——它會在啟動時讀取 config。開啟 popover 觸發讀取，可由伺服器日誌確認：

```
GET /api/usage?days=1&tz=Asia/Taipei -> 200  [ua=VibeUsage CFNetwork/...]
POST /api/usage/ingest -> 200                (app-driven CLI sync)
```

---

## 本地計價

`estimatedCost` 在**讀取時**依 `src/prices.json` 計算，以 CLI 輸出的**確切 `model` 字串**為鍵（該字串已含 provider，
如 `accounts/fireworks/models/glm-5p2`、`zai-org/GLM-5.2`）。**編輯 `src/prices.json`，所有既有資料的費用立刻更新。**
內建價格表目前涵蓋 **91 個 model**。

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

- `input` / `output` / `cacheReadMtok` = 每 **100 萬** token 的美元計價。
- `vendor` / `source` 僅供文件說明，不參與計費計算。
- 價格表中**不存在**的 model → `estimatedCost` 為 `null`（與上游「未匹配 model 得出 nil」一致）。
- 計價來源：`official` = 已對照 provider 公布價格驗證（Anthropic、OpenAI、Google Gemini、
  Fireworks、DeepInfra、DeepSeek、Kimi、MiniMax）；`openrouter` = 取自 OpenRouter `/api/v1/models`，尚未經 vendor 驗證。
- OpenCode Go 為**訂閱制**（首月 $5 / 之後每月 $10）；其 model 刻意以 vendor 每 token *估計*
  計價，讓費用欄位反映**實際用量價值**而非真實訂閱帳單。

---

## 儲存

- **路徑**：`~/.vibe-usage-server/data.json`（可用 `VIBE_USAGE_SERVER_DIR` 覆寫目錄）。
- **Buckets**：以 `source|model|project|hostname|bucketStart` 去重；較大的既有快照勝出（「保護」，與上游一致）。
- **Sessions**：以 `source|sessionHash` 去重。
- 寫入採原子寫入（寫臨時檔再 rename）。

---

## 測試

```bash
node --test "test/*.test.js"     # 8 項測試：計價、去重、認證、過濾、刪除
```

---

## 自動啟動（launchd）

伺服器以使用者 **LaunchAgent** 管理，登入即啟動、當機自動重啟。

Plist：`~/Library/LaunchAgents/com.vibe-usage.local-server.plist`
Logs：`~/.vibe-usage-server/server.log` / `server.err`

```bash
# 載入 / 啟動
launchctl load ~/Library/LaunchAgents/com.vibe-usage.local-server.plist

# 停止（job 保留，除非 KeepAlive 否則不會重啟）
launchctl kickstart -k gui/$(id -u)/com.vibe-usage.local-server

# 完全停用（未來登入不啟動）
launchctl disable gui/$(id -u)/com.vibe-usage.local-server

# 重新啟用
launchctl enable gui/$(id -u)/com.vibe-usage.local-server
launchctl load ~/Library/LaunchAgents/com.vibe-usage.local-server.plist

# 編輯 plist 後（如改 PORT）重新載入：
launchctl unload ~/Library/LaunchAgents/com.vibe-usage.local-server.plist
launchctl load   ~/Library/LaunchAgents/com.vibe-usage.local-server.plist

# 編輯 server.js 後重啟：
launchctl kickstart -k gui/$(id -u)/com.vibe-usage.local-server
```

### 請求日誌（除錯）

可讓伺服器記錄每個收到的請求（確認 App / CLI 確實在打）：

```bash
# 暫時在 plist 的 EnvironmentVariables 加：
#   <key>VIBE_USAGE_LOG_REQUESTS</key><string>1</string>
# 或直接執行：
VIBE_USAGE_LOG_REQUESTS=1 node index.js
```

### 同步時序備註

同步節奏**由 App 驅動**（App 的 `SyncScheduler` 每 **30 分鐘**，外加開啟 popover 時）。
這個 launchd 只負責保持**伺服器**存活，不改變同步時序。當 `apiUrl` 指向 localhost 時，
既有的 `ai.vibecafe.vibe-usage` CLI daemon 也會自動同步到這台伺服器。

---

## 除錯與回滾

**回到 vibecafe.ai**

```bash
# 還原切換前的 config（設定時已建立備份）
mv ~/.vibe-usage/config.json.bak-local-* ~/.vibe-usage/config.json   # 選最新的 *.bak-local-*
# 停止本地伺服器
launchctl disable gui/$(id -u)/com.vibe-usage.local-server
```

**設定 / 憑證備份**

`~/.vibe-usage/config.json` 存放真實 API key（0600）。切換前會在同目錄寫下
`config.json.bak-local-<timestamp>` 備份。**切勿把 key 提交進版本控制。**
