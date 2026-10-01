# 價格表架構（Pricing）

`estimatedCost` **在讀取時**由價格表即時計算。設計上是「canonical（provider 已編在 model 字串裡）價表
＋ 來源覆寫層」，與主流（LiteLLM / OpenRouter / models.dev）同一個思路。

## 檔案與優先序

| 角色 | 路徑 |
|------|------|
| 內建預設表（隨套件出貨） | `src/prices.json` |
| 使用者 override（資料目錄，可用 `VIBE_USAGE_SERVER_DIR` 搬移） | `~/.vibe-usage-server/prices.json` |
| 載入與計價邏輯 | `src/prices.js` |

## 表結構

```jsonc
{
  "$notes": "…",      // 純文件欄位，不參與計算
  "$verified": "…",   // 純文件欄位，不參與計算

  "models": {
    "zai-org/GLM-5.3": { "input": 1.4, "output": 4.4, "cacheReadMtok": 0.26, "vendor": "zai-org", "source": "official" }
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

- 費率單位：**USD / 1 百萬 token**；`cacheWriteMtok` 省略視為 0，其餘欄位皆可省略。
- `vendor` / `source` 僅供文件說明，**不參與計算**。
- 排版：**一個 model 一行**（見 `README` 的 Local pricing 說明）。

## 載入流程（`loadPrices()`）

1. 資料目錄 `prices.json` 存在且含 `models` 物件 → 用它當 **canonical 表**。
   - 它若含 `sources` → 用它的 `sources`。
   - 它若沒有 `sources` → **沿用內建表的 `sources`**（來源覆寫不會被 override 吃掉）。
2. 否則 → 使用內建 `src/prices.json`。
3. 檔案損壞或讀不到 → 回退內建表。

```
資料目錄 prices.json ──有 models──▶ canonical（+ 自己的 sources，或沿用內建 sources）
        │ 無／壞
        └──────────────▶ 內建 src/prices.json
```

## 查表與計價（`estimateCost(bucket)`）

```js
const entry = prices.sources?.[bucket.source]?.models?.[bucket.model]
  ?? prices.models[bucket.model];
if (!entry) return null;
```

```
cost = input × inRate
     + (output + reasoningOutput) × outRate
     + cachedInput × cacheReadRate
     + cacheCreation5m × cacheWriteRate
```

- 兩層都查不到 → `estimatedCost = null`，該 model 會出現在 `GET /api/usage` 的
  `unpricedModels`（讓漏收錄看得見，而不是默默低估）。

## 兩層心智模型

| 層 | 鍵 | 用途 |
|----|----|------|
| `models`（canonical） | 已含 provider 的 model 字串（`zai-org/…`、`accounts/fireworks/…`） | 通用價；**同名同價自然共用** |
| `sources.<source>.models`（覆寫） | `source` + `model` | **稀疏**覆寫；只給「自己就是計費／轉售方」的來源（目前 `commandcode`） |

規則：

- 一般供應商／模型 → 只動 canonical `models`。
- 「自營／轉售」且 id 會與他人撞名的 CLI → 加 `sources.<source>`。
- 客戶端（opencode / codex / claude-code / dsh / hermes…）**不該**有 `sources` 表。

## 為什麼覆寫鍵是 `source`，不是 `provider`

- 價格的屬性是 **(provider, model)**；但 bucket 只帶 `source`（CLI id），沒有 `provider` 欄位。
- 當 CLI 自己就是計費方（Command Code）時，`source` 與 provider **等價**，所以結論上等於 provider 覆寫。
- 要真的以 provider 為鍵，需要二選一：
  - 讓 bucket 契約多帶 `provider`（動 parser + contract + 後端，跨 repo）；或
  - 從 model id 前綴推導（bare id 如 `gpt-5.6-sol` 推不出來，不穩）。
  現階段不值得，維持 `source` 為鍵。
- 與主流的對應：LiteLLM 用扁平 map（model 字串 + `litellm_provider`）、OpenRouter 以 `vendor/model`
  為 id 附 pricing、models.dev 以 provider → models 巢狀並以 provider 覆寫 model metadata
  （`canonical_model_id` 回指同一顆 base model）。

## 調價 / 維護 SOP

- **改價格**：直接改表（資料目錄優先）→ **讀取時即時生效**，所有既有資料的費用立刻更新，**不用重新 sync**。
- **改邏輯**（`prices.js`）：程式於啟動時載入一次，需**重啟 server**。
  launchd：`launchctl kickstart -k gui/$(id -u)/com.vibe-usage.server`
- **新增轉售來源**：加 `sources.<source>.models`，不要改 canonical 表。
- **新增一般供應商/模型**：只加 canonical `models`。

## 常見情況

- `unpricedModels` 非空 → 該 model 兩層都沒收錄 → 補進對應層。
- 同一 id、不同供應商不同價 → 放 `sources`；同名同價 → 放 canonical（共用）。
- override 只寫了 `models` → 來源覆寫仍生效（由內建 `sources` 補上）。
