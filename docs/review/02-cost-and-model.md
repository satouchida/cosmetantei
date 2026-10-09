# Cost and model upgrades

Review date: 2026-10-08, against commit `623dfc9`. Line numbers refer to that commit.

Requirement: the model behind the service should stay lightweight and cost-efficient.
Flash is the right tier for user-facing chat replies. The larger savings come from making fewer
and smaller calls, and from using a cheaper tier for simple classification.

> The model ID `gemini-3.8-flash` (in `wrangler.toml`, `.env.local.example`, and the default in
> `src/lib/services/gemini.ts:4`) was not verified during the review. Check it against Google's
> current model list before deploying. Also confirm the exact thinking parameter name for that
> model generation (`thinkingBudget` vs `thinkingLevel`).

## Current call pattern

| Trigger | Gemini calls | Google Search grounding |
|---|---|---|
| Typical chat message | product discovery (`generateCosmeticsWithGemini`) + chat reply | both calls |
| Greeting / empty input | trending products (`fetchDynamicTrendingCosmetics`) | yes |
| Unknown barcode | barcode lookup + chat reply | both |
| Ingredient "explain" click | one JSON call per ingredient | no |
| Brand/generic term check | none (Clef on Workers AI, first sighting only) | no |

Search grounding is billed separately from tokens, so the first two rows are the main cost drivers.

## 1. Fewer search-grounded calls per message

- [ ] Ground the chat reply only when it's needed

**Where**: `src/lib/services/gemini.ts:219` (`tools: [{ googleSearch: {} }]` on every chat reply)

**Change**: Include the tool only when `contextData.missingIngredientsProduct` is set, i.e. when
the model actually has to look up ingredients. For normal replies the analysis is already supplied
in the prompt.

## 2. Don't call Gemini for greetings

- [ ] Serve greetings without a model call

**Where**: `src/lib/services/live-cosmetics-service.ts:621` calls `fetchDynamicTrendingCosmetics`,
which makes a grounded Gemini call.

**Change**: Return a small set of verified real products from KV (refreshed by a scheduled job,
e.g. a Cron Trigger once a day), or no product cards at all for a greeting.

## 3. Set a thinking limit

- [x] Set thinking explicitly on every call

**Done (2026-10-09):** every call now sends `thinkingConfig.thinkingLevel`, default `low`
(`GEMINI_THINKING_LEVEL` overrides it; Gemini 3 uses levels, not the 2.5-era `thinkingBudget`).
`gemini-3.8-flash` defaults to `medium` and has no `minimal`. Live A/B through the dev gateway:

| Task | medium: thinking + answer tokens, time | low: thinking + answer tokens, time |
|---|---|---|
| Chat reply | 261 + 306, 8.0 s | 0 + 296, 4.9 s |
| Product discovery (grounding tool on) | 1,107 + 751, 16.2 s | 0 + 796, 8.4 s |
| Ingredient JSON | 292 + 137, 6.0 s | 0 + 177, 3.9 s |

Answer quality was comparable on all three, and billed output tokens dropped by about 55%.

**Where**: every `generationConfig` (`gemini.ts:220`, `dynamic-ingredient-service.ts:436`,
`live-cosmetics-service.ts:150`, `:493`)

**Why**: Newer Flash models think by default. Thinking tokens are billed as output and count
toward `maxOutputTokens`, so the chat's `maxOutputTokens: 600` (`gemini.ts:223`) can cut replies
short. Set thinking off or low for chat and JSON calls; the product-discovery call may need a
little.

## 4. Use the Lite tier (or no model) for simple jobs

- [ ] Add a second model setting, e.g. `GEMINI_MODEL_LITE`

| Task | Suggested |
|---|---|
| Brand vs generic term | Done: no Gemini call. Precheck + 90-day cache + self-report + one batched Clef call per search for new brands (`brand-check.ts`) |
| Per-ingredient explanation JSON | Flash-Lite with `responseSchema`; cache permanently in KV (ingredients don't change) |
| Product discovery with grounding | Flash |
| Chat replies | Flash |

## 5. One shared Gemini client

- [ ] Create `src/lib/services/gemini-client.ts`

The same `fetch` + parse code is copied four times (`gemini.ts:198`,
`dynamic-ingredient-service.ts:427`, `live-cosmetics-service.ts:139`, `:483`). One
`callGemini({ model, prompt, system, schema, grounding, thinking })` gives a single place for:

- the API key header and `hasGeminiKey()` (fixes 01 #5 and #8)
- timeouts via `AbortSignal.timeout()` (there are none on Gemini calls today)
- one retry with backoff on 429/503
- joining text parts (fixes 01 #6)
- logging `usageMetadata` (prompt / output / thinking tokens) per call, so cost can be measured
  before and after each change in this document

## 6. Cache more of the prompt

- [ ] Keep the shared prefix stable
- [ ] Cache results in KV

The system prompt (`gemini.ts:23-53`) and the disclaimer are resent on every call. Keep the system
instruction byte-identical and first so implicit prefix caching can apply; consider explicit
context caching if traffic grows. Cache final answers in KV keyed by
`(model, normalized message, product id)` for the repeated "analyze this product" flows.

## 7. Measure first

- [ ] Add per-route counters (calls, grounded calls, tokens) to logs or Workers Analytics Engine

Without this you can't tell which of the changes above matter most. Do it together with item 5.
