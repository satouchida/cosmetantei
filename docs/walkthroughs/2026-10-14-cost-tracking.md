# Cost tracking (2026-10-14)

Item 7 of the [cost review](../review/02-cost-and-model.md#7-measure-first): measure the paid
calls per route, log Gemini's token counts, and put a hard cap on paid web lookups.

## Paid calls in the app today

| Kind | Where | Task label |
|---|---|---|
| Gemini | `chat-replies.ts` (short replies) | `cause_reply`, `ingredient_reply`, `question_reply` |
| Gemini, URL context | `web-research.ts` (reading product pages) | `page_read` |
| Gemini | `dynamic-ingredient-service.ts` (AI explanation) | `ingredient_explain` |
| Gemini, image | `label-reader.ts` (label photo) | `label_read` |
| Workers AI (Clef) | `chat-gate.ts`, `brand-check.ts`, `search-filter.ts` | `chat_gate`, `brand_check`, `search_filter` |
| Web search (Exa, Linkup) | `cloudflare.ts` `runWebSearch` | `web_search` |

Google Search grounding is gone (Gemini redesign, phase 6), so "grounded calls" are no longer
counted. Page reads with URL context are marked instead.

## Usage records

`src/lib/server/usage.ts`:
- **Routes:** each API route is wrapped with `withUsageRoute` (AsyncLocalStorage). Every paid call
  inside it, including background work after the response, is recorded under that route: `chat`,
  `product_search`, `barcode`, `analyze`, `label_read`, `ingredient_explain`. Calls outside a
  route are `other`.
- **One record per call**, made in the three shared wrappers: `callGemini`, `runWorkersAI` and
  `runWebSearch`. Call sites only pass a `task` label, which is required, so new calls can't skip it.
- **Fields:** route, kind, task, model (or search provider), outcome (`ok`, `error`, `capped`, `cache_hit`),
  prompt, output, thought and cached tokens, and time.
  - Gemini tokens come from `usageMetadata`. The prompt count includes `toolUsePromptTokenCount`,
    the page text that URL context reads, which is billed as input.
  - Clef tokens come from its `usage` field.
  - Failed calls are counted too.
  - **Gateway cache hits** (`cf-aig-cache-status: HIT`) are counted as calls with the outcome
    `cache_hit` and no tokens. The replayed `usageMetadata` belongs to the original call, and a
    hit makes no paid request to Google.
- **No text:** prompts, replies, search queries and labels are never written. Test 78 checks that
  a user sentence used as a prompt and as a query appears in neither the log nor the data points.
- **Where it goes:**
  - a `[usage] {...}` log line, visible in Workers Logs and `wrangler tail`;
  - the `USAGE` Workers Analytics Engine dataset `cosmetantei_usage`, when the binding exists.

### Analytics Engine layout and queries

| Column | Value |
|---|---|
| `index1` | kind |
| `blob1`…`blob6` | route, kind, task, model, outcome, `url_context` or empty |
| `double1`…`double6` | 1 (the call), prompt, output, thought, cached tokens, ms |

Query with the [SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)
(an API token with Account Analytics Read):

```sql
SELECT blob1 AS route, blob2 AS kind, blob3 AS task, blob5 AS outcome,
       SUM(_sample_interval * double1) AS calls,
       SUM(_sample_interval * double2) AS prompt_tokens,
       SUM(_sample_interval * double3) AS output_tokens,
       SUM(_sample_interval * double4) AS thought_tokens
FROM cosmetantei_usage
WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY route, kind, task, outcome
ORDER BY calls DESC
```

The app records counts, not prices. Multiply by the current price list to get cost. The AI
Gateway dashboard also shows Gemini and Workers AI spend per model.

## Hard cap on paid web searches

- **Before:** web searches were limited only per IP: the `ai` bucket allows 20 requests a minute
  per user, with up to two searches each. The total across all users had no ceiling.
- **Now:** `WEB_SEARCH_LIMITER` (a new rate-limit binding, namespace 1003) allows 30 searches a
  minute, shared by all users. Every search, including the Linkup fallback, counts once.
- **It counts per Cloudflare location, not worldwide.** Cloudflare's docs say rate limits are
  local to the location the Worker runs in, and are permissive and eventually consistent. Traffic
  served from N locations can make up to about 30 × N searches a minute. So this stops a burst; it
  is not a strict global ceiling. A strict one needs a counter in a single Durable Object.
  - Over the cap, the search is skipped and recorded as `capped`.
  - Research then behaves as if the search failed, so the user gets the usual 「見つかりませんでした」
    path, and nothing is cached as a miss.
- **Without the binding** (`next dev`, tests), an in-memory cap with the same number applies per
  isolate.
- **Limits of the binding:** it can only count per 10 or 60 seconds, so this is a per-minute
  limit, not a daily budget. AI Gateway's own rate limiting
  (dashboard setting) can add a ceiling on the gateway side.

## Tests

Test 78 covers:
- one record per call with its route, task, model and token counts (URL-context page tokens
  included);
- no prompt or query text in the log or the data points;
- `other` outside a route, and failed calls counted as `error`;
- the binding refusing: no search is made, and the call is recorded as `capped`;
- the in-memory cap after 30 searches.

The suite resets the in-memory cap before each test, because the whole suite runs in one
process.

Also checked on `wrangler dev`: both bindings load (local simulation), and a greeting logs one
`chat_gate` call under the `chat` route with its token count.

## Not done

- **Retry on 429/503** in `callGemini` (review item 5). It would change call counts, so it should
  be added with these numbers in view.
- **A strict global or daily budget.** That needs one counter that every request sees, such as
  a single Durable Object, which adds a round trip to every search. For now the per-location cap
  and the per-IP limits cover the risk.

## Code review

`code-improver` found nothing Critical or High. Fixed:
- **Medium:** gateway cache hits were counted with the original call's tokens. They are now
  `cache_hit` with no tokens.
- **Medium:** the docs called the cap global. Checked against Cloudflare's rate-limit docs
  (Locality, Accuracy): it is per location. The docs, code comment and `wrangler.toml` now say so.
- **Low:** the cap test now checks the call that crosses the limit, and resets the cap in its
  `finally`.

Declined:
- **Not awaiting `recordUsage`:** the Analytics Engine write is synchronous. The await only
  covers a cached binding lookup, and awaiting keeps the record from being lost when the isolate
  ends.
- **Moving `getBindings` to its own module** to break the `cloudflare.ts` ↔ `usage.ts` cycle: both
  sides only use each other inside functions, so it is safe as is.

