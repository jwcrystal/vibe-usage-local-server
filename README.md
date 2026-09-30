# vibe-usage-local-server

在本地重現 vibe-usage 的資料接收與 dashboard API，讓整套 vibe-usage（CLI + macOS App）
**完全不依賴雲端運作**——不上傳 vibecafe.ai，並可自行調整模型計價。

- **Node.js ≥ 20，零運行時依賴**
- 接收 `@vibe-cafe/vibe-usage` CLI 的 token 用量，再回傳給 Mac App dashboard
- 費用（`estimatedCost`）在**讀取時**依本地可編輯的價格表即時計算，改價格立即套用至既有資料，無需重同步
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
- [未來優化路徑（storage + 查詢）](#未來優化路徑storage--查詢)

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
| `GET /api/usage` | 回傳過濾後的 buckets（`days`/`from`/`to`/`tz`）＋ `unpricedModels`（價格表缺的 model 清單） | ✅ |
| `GET /api/usage/settings` | 回傳 `{ uploadProject: true }`（CLI 同步前會先取） | ✅ |
| `DELETE /api/usage/ingest` | 重設（可加 `?hostname=`） | 選用 |
| `POST /api/usage/device/code` + `/poll` | 不支援 — 請用 `--manual-key` | — |

### 專案結構

```
vibe-usage-local-server/
├── index.js               # 進入點 + npm bin（node index.js / vibe-usage-server）
├── src/
│   ├── server.js         # HTTP server、路由、認證、gzip、過濾
│   ├── store.js          # JSON 持久化、bucket/session 去重
│   ├── prices.js         # 價格表載入與費用計算
│   ├── prices.json       # ★ 你的本地價格表（可自由編輯）
│   └── ui/
│       └── dashboard.html # 單檔 Web dashboard（零依賴）
├── scripts/
│   ├── com.vibe-usage.server.plist # launchd LaunchAgent 範本
│   ├── install-launchd.sh           # 安裝 + 啟動（登入自啟、當機重啟）
│   └── uninstall-launchd.sh         # 移除
└── test/
    └── server.test.js    # node:test 測試 (8 項)
```

---

## 快速開始

```bash
# 0. （可選）以 npm 全域安裝 — 之後直接 `vibe-usage-server` 即可
npm pack && npm install -g ./vibe-usage-local-server-0.1.1.tgz

# 1. 啟動伺服器（手動，或改用 launchd，見下方）
node index.js          # 或已全域安裝：vibe-usage-server
#   Vibe Usage local server listening on http://127.0.0.1:3456

# 2. 將 CLI 指到伺服器
npx @vibe-cafe/vibe-usage init --manual-key vbu_xxx
#    確認 ~/.vibe-usage/config.json 為：
#    { "apiKey": "vbu_xxx", "apiUrl": "http://127.0.0.1:3456" }

# 3. 同步（寫入本地伺服器）
VIBE_USAGE_API_URL=http://127.0.0.1:3456 npx @vibe-cafe/vibe-usage sync
```

> 打包：`npm pack` 產出 `vibe-usage-local-server-<version>.tgz`，內容為純 Node source
> （`src/`、`ui/`、`index.js`），零依賴、任一平台 npm install 皆可直接執行（需 Node ≥ 20）。

### 正式安裝（npm 全域）＋自訂資料目錄

若不想從 repo 手動啟動，可用 npm 全域安裝，之後直接 `vibe-usage-server`。資料與
價格預設都在 `~/.vibe-usage-server/`；可用 `VIBE_USAGE_SERVER_DIR` 指到自訂目錄——

把 server 跑在自訂目錄，資料 / 價格 / 日誌都收在一起：

```bash
# 1. 安裝
npm install -g vibe-usage-local-server   # 或從本地 tgz：npm install -g ./vibe-usage-local-server-0.1.1.tgz

# 2. 建立自訂資料目錄（可選；不設就預設 ~/.vibe-usage-server/）
mkdir -p /Volumes/Data/vibe-usage

# 3. 啟動（用 VIBE_USAGE_SERVER_DIR 指定資料目錄；此 env 同時決定 data.json 與 prices.json 位置）
VIBE_USAGE_SERVER_DIR=/Volumes/Data/vibe-usage vibe-usage-server
#   Vibe Usage local server listening on http://127.0.0.1:3456
#   Data: /Volumes/Data/vibe-usage/data.json

# 4. 把 CLI 指到伺服器
npx @vibe-cafe/vibe-usage init --manual-key vbu_xxx
#    確認 ~/.vibe-usage/config.json 為：
#    { "apiKey": "vbu_xxx", "apiUrl": "http://127.0.0.1:3456" }

# 5. 同步（在第 3 步同樣的 VIBE_USAGE_SERVER_DIR 環境下，讓 CLI 也寫進同一目錄）
VIBE_USAGE_SERVER_DIR=/Volumes/Data/vibe-usage \
VIBE_USAGE_API_URL=http://127.0.0.1:3456 \
npx @vibe-cafe/vibe-usage sync
```

> **`VIBE_USAGE_SERVER_DIR` 同時決定 `data.json` 與 `prices.json` 的位置**——把一個
> `prices.json` 放進該目錄即覆蓋內建價格表（見下方 [本地計價](#本地計價)）。
> 注意：server 與 CLI 若都要用同一資料目錄，就讓兩者都設同一個 `VIBE_USAGE_SERVER_DIR`。

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

載入時有錯落淡入，卡片 / 圓環 hover 浮起、長條與熱力格 hover 強調、表格列強調，各處也有對應的 hover 提示。
圖表長條一律用**像素高度**（非 CSS `%`），才不會在 flex 或瀏覽器怪異行為下溢位成整欄色塊。

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

`estimatedCost` 在**讀取時**依價格表即時計算，以 CLI 輸出的**確切 `model` 字串**為鍵（該字串已含 provider，
如 `accounts/fireworks/models/glm-5p2`、`zai-org/GLM-5.2`）。**改價格表，所有既有資料的費用立刻更新。**
內建價格表目前涵蓋 **91 個 model**。

### prices.json 要放在哪？

override 價格表依**優先序**找，第一個命中的生效：

| 順位 | 路徑 | 適用情境 |
|------|------|----------|
| 1 | `~/.vibe-usage-server/prices.json`（資料目錄，可用 `VIBE_USAGE_SERVER_DIR` 搬移） | **建議**——與使用者資料放一起，重裝套件不會被清掉 |
| 2 | `src/prices.json` | 純 Node source 開發時，直接編輯內建預設表 |

啟動時依序檢查（資料目錄優先）；兩者都沒有、或檔案不合法（不含 `models` 物件）就退回**內嵌預設表**
（`src/prices.json`）。

> Node source（`node index.js`）：除了資料目錄的 override，內建表就是 `src/prices.json`，開發時直接改它即可。

### 完整自訂範例

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

### 欄位說明

- `input` / `output` / `cacheReadMtok` = 每 **100 萬** token 的**美元**計價，皆可省略（省略視為 0）。
- 成本公式（`prices.js`）：`input×inRate + (output + reasoningOutput)×outRate + cachedInput×cacheReadRate`。
- `vendor` / `source` 僅供文件說明，**不參與計費計算**。
- 價格表中**不存在**的 model → `estimatedCost` 為 `null`（與上游「未匹配 model 得出 nil」一致）。
- 計價來源：`official` = 已對照 provider 公布價格驗證（Anthropic、OpenAI、Google Gemini、
  Fireworks、DeepInfra、DeepSeek、Kimi、MiniMax）；`openrouter` = 取自 OpenRouter `/api/v1/models`，尚未經 vendor 驗證。
- OpenCode Go 為**訂閱制**（首月 $5 / 之後每月 $10）；其 model 刻意以 vendor 每 token *估計*
  計價，讓費用欄位反映**實際用量價值**而非真實訂閱帳單。

---

## 儲存

- **路徑**：`~/.vibe-usage-server/data.json`，可用 `VIBE_USAGE_SERVER_DIR` 環境變數覆寫整個資料目錄
  （eg. `VIBE_USAGE_SERVER_DIR=/Volumes/Data/vibe-usage` → `data.json` 與 `prices.json` 都在該目錄）。
- **Buckets**：以 `source|model|project|hostname|bucketStart` 去重；較大的既有快照勝出（「保護」，與上游一致）。
- **Sessions**：以 `source|sessionHash` 去重。
- 寫入採原子寫入（寫臨時檔再 rename）。
- **備份與復原**：每次啟動首次讀取時，把健康的 `data.json` 快照一份成 `data.json.bak`；若 `data.json` 損毀，自動改讀 `.bak`，並把壞檔保留為 `data.json.corrupt` 供人工檢查。

---

## 測試

```bash
node --test "test/*.test.js"     # 11 項測試：計價、去重、認證、過濾、刪除、未計價清單、綁定守護、備份復原
```

---

## 自動啟動（launchd）

伺服器以使用者 **LaunchAgent** 管理，**登入即啟動**（`RunAtLoad`）、**當機自動重啟**（`KeepAlive`）。

用內建腳本安裝（會自動解析 `vibe-usage-server` 命令位置、寫入 plist 並啟動）：

```bash
./scripts/install-launchd.sh
# 若 command 不在 PATH：./scripts/install-launchd.sh --bin /path/to/vibe-usage-server

# 停止（job 保留）
launchctl bootout gui/$(id -u)/com.vibe-usage.server

# 完全停用（未來登入不啟動）
launchctl disable gui/$(id -u)/com.vibe-usage.server
launchctl enable gui/$(id -u)/com.vibe-usage.server   # 重新啟用

# 移除 LaunchAgent
./scripts/uninstall-launchd.sh
```

Plist：`~/Library/LaunchAgents/com.vibe-usage.server.plist`
Logs：`~/.vibe-usage/logs/` (`vibe-usage-server.log` / `server.err`)
Log rotation：`install-launchd.sh` 會嘗試（需 sudo，非互動）安裝 `/etc/newsyslog.d/com.vibe-usage.server.conf`——1MB 輪替、保留 3 份壓縮檔；無 sudo 時印出手動指令。
State：`launchctl print gui/$(id -u)/com.vibe-usage.server`

> 若 launchd 想搭配自訂資料目錄，在 plist 的 `EnvironmentVariables` 加入
> `<key>VIBE_USAGE_SERVER_DIR</key><string>/Volumes/Data/vibe-usage</string>` 再
> `launchctl bootstrap gui/$(id -u) <plist>` 重新載入。

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
launchctl bootout gui/$(id -u)/com.vibe-usage.server
```

**設定 / 憑證備份**

`~/.vibe-usage/config.json` 存放真實 API key（0600）。切換前會在同目錄寫下
`config.json.bak-local-<timestamp>` 備份。**切勿把 key 提交進版本控制。**

---

## 未來優化路徑（storage + 查詢）

> 這段是**決策備忘**，不是待辦。目前維持 JSON，不動，因為：
> 實測約 **2.6MB / 351 天 / ~3.6 buckets/day**（1274 buckets + 6797 sessions），
> 外推 **5 年 ≈ 13MB**。JSON 全載入 + 原子寫回對這個量級是 **幾 ms**，遠低於感知閾值
> （每 30 分鐘才 sync 一次）。**SQLite 在此量級無可量測優勢。**

### 當前的查詢行為

- `GET /api/usage` 會 `loadData()`（`readFileSync` + `JSON.parse` **整檔**），
  buckets 已 server 端依 `days/from/to` 過濾，但 **sessions 全量回傳**，由 dashboard
  在瀏覽器端依選定範圍篩選（計 Active / 總時長 / 訊息卡）。
- 因資料量小，整檔 parse + 瀏覽器端 filter 都無感，「sessions 未 server 端過濾」**不是 bug**。

### 優化時機點

唯有出現以下真實痛點之一再進入優化：

- data.json 使 `loadData()` 的 parse / 序列化有感延遲（例如 > 100ms，約對應 **~100+MB**）；
- dashboard 每次載 view 因回傳全量 sessions 而明顯卡頓；
- 出現多使用者 / 需跨時間聚合的自訂查詢；
- 需保留更細的「原始事件流」（量級比 buckets/sessions 大 10~100 倍）。

### 兩條路線的取捨

| 路線 | 做法 | 優點 | 代價 |
|------|------|------|------|
| **A. JSON 分片（sharding）** | 依時間切成多個小檔（如 `data-2026-06.json`），查詢只 parse 所需月份的檔 | 保持 **zero-dependency**；格式仍與 CLI / Mac App 相容（回讀整份、僅查詢 parse 當月）；在 `store.js` 內改，影響面小 | 需實作分片寫入 / 讀取邏輯與多檔管理 |
| **B. SQLite** | `WHERE bucketStart BETWEEN ...` 真 partial read | 原生支持時間範圍查詢、index、部分讀取 | 破 zero-dependency；要用 native module（better-sqlite3）或 Node 26+ 內建 `node:sqlite`（與 `engines: >=20` 衝突）；storage 格式需對齊 CLI / App；需一次資料遷移 |

若真到那一天，**優先走 A（JSON 分片）**：它比 sqlite 更貼合本 repo 的 zero-dep /
CLI-App-相容哲學，且可在 store 層做、不必動 API。**sqlite 只在「細粒度事件流 + 複雜查詢」
同時出現時才值得考慮。** 在那之前，維持現狀，讓資料自然增長。

---

## 致謝

本專案受 [vibe-usage](https://github.com/vibe-cafe/vibe-usage) 啟發——在本地重現其資料接收
與 dashboard API，並與其 CLI（`@vibe-cafe/vibe-usage`，MIT）直接相容。

## License

MIT — see [LICENSE](LICENSE).
