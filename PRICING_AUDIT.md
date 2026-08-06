# Official Pricing Audit

Audited 2026-08-06. Prices are USD per 1M tokens.

## CSV Verification (ai_model_pricing_full.csv vs official sources)

### Anthropic — https://www.anthropic.com/pricing#api

| CSV model | CSV price | Verdict | Note |
| --- | --- | --- | --- |
| Opus 4.8 / 4.7 / 4.6 / 4.5 | 5 / 0.5 / 25 | ✅ official | cache read $0.50 confirmed |
| Opus 4.1 | 15 / 1.5 / 75 | ✅ official | deprecated |
| Opus 5 | 5 / 0.5 / 25 | ✅ official | docs table + claude.com/pricing |
| Fable 5 | 10 / 1 / 50 | ✅ official | docs table + claude.com/pricing |
| Mythos 5 | 10 / 1 / 50 | ✅ official | docs table + claude.com/pricing, limited availability |
| Sonnet 5 | 2 / 0.2 / 10 | ✅ official | intro through 2026-08-31; then 3/0.3/15 standard (update table 2026-09-01) |
| Sonnet 4.6 / 4.5 | 3 / 0.3 / 15 | ✅ official | |
| Haiku 4.5 | 1 / 0.1 / 5 | ✅ official | |
| Haiku 3.5 | 0.8 / 0.08 / 4 | ✅ official | retired except Bedrock/GCP |

### OpenAI — https://developers.openai.com/api/docs/pricing

| CSV model | CSV price | Verdict | Note |
| --- | --- | --- | --- |
| gpt-5.6-sol / terra / luna | 5/0.5/30, 2/0.2/12, 0.2/0.02/1.2 | ✅ official | short context; long ctx (>272K) is 2x input / 1.5x output |
| gpt-5.5 / gpt-5.4 | 5/0.5/30, 2.5/0.25/15 | ✅ official | |
| gpt-5.4-mini / nano | 0.75/0.075/4.5, 0.2/0.02/1.25 | ✅ official | |
| gpt-5.5-pro / gpt-5.4-pro | 30 / - / 180 | ✅ official | no cache price |
| chat-latest | 5 / 0.5 / 30 | ✅ official | ChatGPT routing |
| gpt-5.3-codex | 1.75 / 0.175 / 14 | ✅ official | |
| gpt-realtime-2.1 (audio/text) | 32/0.4/64, 4/0.4/24 | ✅ official | |
| gpt-realtime-2.1-mini (audio/text) | 10/0.3/20, 0.6/0.06/2.4 | ✅ official | CSV only listed audio row |

### Google — https://ai.google.dev/gemini-api/docs/pricing

| CSV model | CSV price | Verdict | Note |
| --- | --- | --- | --- |
| Gemini 3.6 Flash | 1.5 / 7.5 | ✅ official | cache $0.15 |
| Gemini 3.5 Flash | 1.5 / 9 | ✅ official | cache $0.15 |
| Gemini 3.5 Flash-Lite | 0.3 / 2.5 | ✅ official | cache $0.03 |
| Gemini 3.1 Pro Preview | 2 / 12 | ✅ official | >200K: 4 / 18; cache 0.2 / 0.4 |
| Gemini 3.1 Flash-Lite | 0.25 / 1.5 | ✅ official | audio $0.5 |
| Gemini 2.5 Pro | 1.25 / 10 | ✅ official | >200K: 2.5 / 15; cache 0.125 / 0.25 |
| Gemini 2.5 Flash | 0.3 / 2.5 | ✅ official | cache $0.03 |
| Gemini 2.5 Flash-Lite | 0.1 / 0.4 | ✅ official | cache $0.01 |

Image/audio/video and tool rows (gpt-image*, sora, transcribe, web search, containers) were not verified — out of scope for per-token chat pricing.

## Required Changes

| Model IDs | Current table | Official rate | Difference | Action | Official source |
| --- | --- | --- | --- | --- | --- |
| `gemini-2.5-pro`, `google/gemini-2.5-pro` | input $1.25, output $10, cache read $0.125 | For prompts over 200K: input $2.50, output $15, cache read $0.25 | Current scalar values understate long prompts | Do not overwrite current values; add tier-aware pricing before applying this rate | [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-pro) |
| `gemini-3.1-pro-preview`, `google/gemini-3.1-pro-preview` | input $2, output $12, cache read $0.20 | For prompts over 200K: input $4, output $18, cache read $0.40 | Current scalar values understate long prompts | Do not overwrite current values; add tier-aware pricing before applying this rate | [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-pro-preview) |

## Verified Current Values

| Model IDs | Input | Output | Cache read | Official source |
| --- | ---: | ---: | ---: | --- |
| `claude-opus-4-6` | $5 | $25 | $0.50 | [Anthropic API pricing](https://www.anthropic.com/pricing#api) |
| `claude-sonnet-4-6` | $3 | $15 | $0.30 | [Anthropic API pricing](https://www.anthropic.com/pricing#api) |
| `claude-haiku-4-5` | $1 | $5 | $0.10 | [Anthropic API pricing](https://www.anthropic.com/pricing#api) |
| `gpt-5.6-sol` | $5 | $30 | $0.50 | [OpenAI API pricing](https://openai.com/api/pricing/) |
| `gpt-5.6-terra` | $2 | $12 | $0.20 | [OpenAI API pricing](https://openai.com/api/pricing/) |
| `gpt-5.6-luna` | $0.20 | $1.20 | $0.02 | [OpenAI API pricing](https://openai.com/api/pricing/) |
| `gemini-2.5-flash`, `google/gemini-2.5-flash` | $0.30 | $2.50 | $0.03 | [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash) |
| `gemini-2.5-flash-lite`, `google/gemini-2.5-flash-lite` | $0.10 | $0.40 | $0.01 | [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-lite) |
| `gemini-3.1-flash-lite-preview`, `gemini-3.1-flash-lite`, `google/gemini-3.1-flash-lite-preview`, `google/gemini-3.1-flash-lite` | $0.25 | $1.50 | $0.025 | [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-lite) |

## Not Represented By Current Schema

- Anthropic and OpenAI cache write charges cannot be calculated: incoming buckets expose cache reads only.
- Google context-cache storage charges cannot be calculated: incoming buckets expose no cache storage duration.
- Google audio token rates differ from text/image/video rates; buckets expose no token modality.
- OpenRouter IDs must use OpenRouter's own rate, not a direct-provider rate.
