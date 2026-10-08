# Fixes (correctness and safety)

Review date: 2026-10-08, against commit `623dfc9`. Line numbers refer to that commit.
Ordered by priority. Tick items off as they land.

**Status (2026-10-08):** all 8 fixes implemented. Remaining manual step: create the KV namespace and uncomment `[[kv_namespaces]]` in `wrangler.toml`; until then caches fall back to per-isolate memory.

## 1. Fabricated products are shown and recommended with affiliate links

- [x] Remove product synthesis
- [x] Remove or clearly label baseline "generic" products

**Where**
- `src/lib/services/live-cosmetics-service.ts:693` `synthesizeDynamicCandidate`
- Called from `searchCosmeticsLive`, `fetchDynamicTrendingCosmetics` (same file) and `searchCosmetics` (`src/lib/services/search-barcode-service.ts`)
- `src/lib/analyzer/ingredient-analyzer.ts:96` `findSafeAlternatives`
- `src/lib/data/cosmetics-db.ts:33`, `:47` (made-up barcodes `4560123456789`, `4560123456796`)

**Problem**
When search results run short, the app pairs a real brand taken from the cache with an invented
product name and an invented ingredient list (e.g. "キュレル 薬用 低刺激リペアクリーム"). The result
is added to the product cache via `addProductToDynamicCache`, so later searches treat it as real.
`findSafeAlternatives` can then recommend it as a "safe alternative" with an Amazon affiliate link.
This contradicts commit `41b62e3` ("eliminate fictional products") and is the most serious issue
for a skin-safety app.

**Fix**
- Return fewer results (or none, with a "try a more specific name / scan the barcode" message)
  instead of synthesizing.
- Never put synthesized or Gemini-estimated products into `findSafeAlternatives`; only recommend
  products whose ingredients came from a real source (Open Beauty Facts, user-pasted label).
- Drop the fake barcodes; if the baseline items stay, mark them as reference formulas, never as
  purchasable products, and give them no Amazon link.
- Update tests 2, 9, 15, 16 in `tests/test_suite.ts`, which currently assert that synthesis fills results.

## 2. Unknown ingredients default to "safe"

- [x] Add an "unknown" risk level

**Where**: `src/lib/services/dynamic-ingredient-service.ts:324` (final fallback of `generateIngredientExplanation`)

**Problem**: Any ingredient no rule recognizes gets `riskLevel: 'safe'` with reassuring text
("強い刺激となる報告は少ない安全性の高い成分です"). That is a claim the app cannot back up.

**Fix**: Add `'unknown'` to `IngredientRiskLevel` (`src/lib/types/index.ts`), use it here, show it
neutrally in `IngredientAnalysisCard`, and offer the AI explanation button for it.

## 3. Off-topic filter blocks real questions and lets everything else through

- [x] Fix the patterns
- [x] Decide whether the prefilter should exist

**Where**: `src/lib/services/gemini.ts:72-109`

**Problem**
- `/…|DAN/i` (line 79) matches any text containing "dan": "Dandelion extract", "redundant".
- `/html|css|java/` etc. have similar substring false positives.
- `isCosmeticTopicRelevant` ends with `return true` (line 108), so the keyword list never rejects anything.

**Fix**: Use word boundaries and case-sensitive `\bDAN\b`, or delete the regex list and rely on the
system prompt's guardrail. If the goal is cost control, a cheap classifier call (see
`02-cost-and-model.md`) is more reliable than regexes.

## 4. In-memory caches and rate limiting don't work on Cloudflare Workers

- [x] Move caches to KV (code done; the `APP_CACHE` namespace still has to be created, see `wrangler.toml`)
- [x] Use the Workers Rate Limiting binding
- [x] Rate-limit every endpoint that can reach Gemini

**Where**
- `src/lib/services/gemini.ts:56` `responseCache`
- `src/app/api/chat/route.ts:15` `ipRequestHistory`
- `src/lib/services/dynamic-ingredient-service.ts:9` `DYNAMIC_INGREDIENT_CACHE`
- `src/lib/services/live-cosmetics-service.ts:97` `GEMINI_TERM_JUDGMENT_CACHE`
- `src/lib/data/cosmetics-db.ts:58` `RUNTIME_CACHE`

**Problem**: Worker memory is per isolate and short-lived, so most requests start with empty caches
and an empty rate-limit history. The Maps also grow without bound while an isolate lives.
`/api/products/search` and `/api/ingredients/explain` call Gemini with no rate limit at all, and
`limit=` on search (`src/app/api/products/search/route.ts:7`) is not capped or NaN-checked.

**Fix**: Workers KV (or D1) for product / ingredient / term caches with TTLs; the Cache API for
response caching; the `ratelimit` binding in `wrangler.toml` applied in a shared helper used by all
API routes. Clamp `limit` to 1–10.

## 5. Gemini API key is sent in the URL

- [x] Send it as a header

**Where**: `src/lib/services/gemini.ts:200`, `dynamic-ingredient-service.ts:428`,
`live-cosmetics-service.ts:142`, `:486`

**Fix**: Use `headers: { 'x-goog-api-key': GEMINI_API_KEY }` and drop `?key=` so the key can't end
up in logs or error traces. Best done as part of the shared client (`02-cost-and-model.md` item 5).

## 6. Fragile parsing of Gemini responses

- [x] Join all text parts
- [x] Use structured output instead of regex

**Where**: `gemini.ts:235`, `dynamic-ingredient-service.ts:450`, `live-cosmetics-service.ts:155-157`,
`:501-504`

**Problem**: Only `parts[0].text` is read. With search grounding or thinking on, the answer can be
split across several parts. Product lists and term judgments are pulled out with regex
(`/\{[\s\S]*\}/`), which breaks on extra text or nested braces.

**Fix**: `parts.filter(p => p.text && !p.thought).map(p => p.text).join('')`. Use
`responseMimeType: 'application/json'` plus `responseSchema` for every JSON call (the ingredient
endpoint already uses the MIME type). Validate enum fields such as `riskLevel` and `category`
before trusting them. Check whether your model allows structured output together with the
`googleSearch` tool; if not, keep the grounded call as text and do a second, cheap
structured-extraction call.

## 7. A failed Gemini call marks the term as a real brand, and caches it

- [x] Fail closed and don't cache failures

**Where**: `src/lib/services/live-cosmetics-service.ts:172`

**Fix**: On error, return `isAuthenticBrand: false` (or "unknown") and don't write it to the cache,
so a transient outage doesn't permanently whitelist a term.

## 8. Inconsistent API-key placeholder checks

- [x] One shared helper

**Where**: `live-cosmetics-service.ts:118` checks `=== 'YOUR_GEMINI_API_KEY'`; `:453` uses
`.includes(...)`; `gemini.ts:149` and `dynamic-ingredient-service.ts` check
`'YOUR_GEMINI_API_KEY_HERE'`.

**Fix**: `export function hasGeminiKey(): boolean` in the shared client, used everywhere.

## Follow-up from the code-improver review (2026-10-08)

A review of the fixes above found gaps; all fixed in the same commit:

- [x] Safe alternatives matched culprits by Japanese name only, so an English-INCI product with
  "Parfum" could be recommended against a 香料 culprit. Now matched via the known-ingredient DB
  (ID, Japanese and English names); products with any moderate/high irritant are never recommended;
  low-irritant culprits such as 水 no longer exclude every product.
- [x] Products with no or mostly unknown ingredient data got the green "safe" badge. New overall
  level `insufficient_data` with a grey badge and its own summary.
- [x] Differential culprits not in the known DB were always "注意成分"; they now use the same
  rule-based level as single-product analysis, including `unknown`.
- [x] An AI estimate could overwrite a verified (Open Beauty Facts) product in the cache. Verified
  products are now kept, and stored in KV (`verified-products:v1`) so new isolates can still
  recommend them.
- [x] The KV memory layer kept values for their full TTL, hiding other isolates' writes; now capped
  at 60 seconds when KV is bound.
- [x] Truncated Gemini replies (`finishReason: MAX_TOKENS`) were cached for 30 minutes; now shown
  but not cached, and truncated JSON is discarded. Chat `maxOutputTokens` raised to 1024.
- [x] Rate limiting degraded silently when bindings were missing; now logged once in production.
  IPv6 clients are keyed by /64 prefix.
- [x] Search results are cached in KV (1 hour, 5 minutes when empty); stale type-ahead requests are
  aborted in the browser.
- [x] `/api/analyze`, `/api/chat` and `/api/products/barcode` validate input shape and size
  (`src/lib/server/validation.ts`); barcodes must be 8–14 digits.
- [x] Barcodes matched only by an AI guess are no longer stored as confirmed matches; misses are
  cached for 1 hour.
- [x] AI explain button shows an error on 429/failure; `routine.safeProducts` null crash fixed.
- [x] Ingredient rules: "tea tree" no longer matches TEA; 炭酸 salts no longer match charcoal.
- [x] `server-only` guard on server modules; a client import now fails the build (verified).

Not done: `judgeGenericOrBrandWithGemini` is still not called by the app (wiring it in would add a
Gemini call per product brand; see `02-cost-and-model.md`).

