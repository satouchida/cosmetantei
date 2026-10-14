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

## Strict spend cap

The first version capped web searches with a rate-limit binding. Cloudflare's docs (Locality,
Accuracy) say those count per location and only approximately, so it was not a real ceiling.
It is replaced by one counter that every request sees.

- **The counter:** `SpendCapObject`, a Durable Object (`src/worker/spend-cap-object.ts`). The app
  uses only the instance named `global`. The counter queues calls itself, so read-add-write
  cannot interleave. The Durable Object's input gates also protect its storage access.
  - **Day counts:** kept in its SQLite storage, so they survive restarts.
  - **The last 60 seconds:** kept in memory. After a restart (deploy, crash) the minute limit can
    be exceeded once, by up to its own size per bucket. The day limit still holds.
  - **Logic:** the counting is in `src/lib/server/spend-cap-core.ts` and has no Cloudflare
    dependencies, so test 79 runs it directly.
- **Buckets and limits:** each paid kind has its own limit, written 「per minute / per day (UTC)」
  in `[vars]`:

  | Bucket | Variable | Default |
  |---|---|---|
  | Web search (Exa, Linkup) | `SPEND_CAP_WEB_SEARCH` | `30/1000` |
  | Gemini | `SPEND_CAP_GEMINI` | `60/3000` |
  | Workers AI (Clef) | `SPEND_CAP_WORKERS_AI` | `120/10000` |

  The defaults are starting points, not derived from a budget. Set them from the price list
  and the numbers in the usage dataset. A missing or malformed value falls back to the default.
- **When it applies:** `callGemini`, `runWorkersAI` and `runWebSearch` ask the counter before
  every call.
  - **Over the limit:** the call is not made and is recorded as `capped`. Callers already
    handle a missing answer: fixed replies, 「見つかりませんでした」, or the chat gate's fallback.
  - **What counts:** every attempt, including calls that then fail or hit the gateway cache.
    The cap errs on the side of spending less.
- **Fails closed:** if the counter can't be reached (error, or no answer within 2 seconds), the
  call is refused.
- **No binding:**
  - in `next dev` and tests, a per-isolate in-memory counter with the same limits is used;
  - **in production the call is refused.** A missing binding there is a misconfiguration, and a
    per-isolate counter would multiply the limit by the number of isolates.
  - Set `SPEND_CAP_ALLOW_MEMORY=true` to run a production build without the binding
    (`next start`).
- **Wiring:**
  - The class must be exported from the Worker entry, so `wrangler.toml` `main` is now `worker.ts`.
    It re-exports OpenNext's handler and Durable Objects, plus `SpendCapObject`, following OpenNext's
    custom-worker pattern.
  - `worker.ts` imports the generated `.open-next/worker.js`, so it is left out of `tsc` and ESLint.
  - The binding is `SPEND_CAP`, with a `v1` migration (`new_sqlite_classes`, which the free plan
    supports).
  - The `WEB_SEARCH_LIMITER` rate-limit binding is removed.
- **Cost of the check:** one Durable Object request before each paid call. That call goes to
  wherever the object lives, so far-away users get a little more latency.
- **Checked on `wrangler dev`** with the real Durable Object:
  - a normal chat message is allowed and recorded;
  - with `--var SPEND_CAP_WORKERS_AI:0/0`, the Clef call is skipped and recorded as `capped`.

## Tests

Test 78 covers:
- one record per call with its route, task, model and token counts (URL-context page tokens
  included);
- no prompt or query text in the log or the data points;
- `other` outside a route, and failed calls counted as `error`;
- the counter refusing: no web search, Gemini or Workers AI call is made, each is recorded as
  `capped`, and the counter is asked with the right bucket and limits;
- a counter error refuses the call;
- the in-memory cap after 30 searches a minute.

Test 79 covers:
- the per-minute and per-day limits;
- refused calls are not counted;
- separate buckets, and the reset at the UTC day boundary;
- day counts surviving a re-created object;
- 400 for a bad request;
- parsing `SPEND_CAP_*`.

The suite resets the in-memory counter before each test, because the whole suite runs in one
process.

Also checked on `wrangler dev`: both bindings load (local simulation), and a greeting logs one
`chat_gate` call under the `chat` route with its token count.

## Not done

- **Retry on 429/503** in `callGemini` (review item 5). It would change call counts, so it should
  be added with these numbers in view.

## Code review

`code-improver` found nothing Critical or High. Fixed:
- **Medium:** gateway cache hits were counted with the original call's tokens. They are now
  `cache_hit` with no tokens.
- **Medium:** the docs called the cap global. Checked against Cloudflare's rate-limit docs
  (Locality, Accuracy): it is per location. The owner then asked for a strict cap, which
  replaced it (above).
- **Low:** the cap test now checks the call that crosses the limit, and resets the cap in its
  `finally`.

Declined:
- **Not awaiting `recordUsage`:** the Analytics Engine write is synchronous. The await only
  covers a cached binding lookup, and awaiting keeps the record from being lost when the isolate
  ends.
- **Moving `getBindings` to its own module** to break the `cloudflare.ts` ↔ `usage.ts` cycle: both
  sides only use each other inside functions, so it is safe as is.

### Review of the strict cap

`code-improver` found two High issues, both fixed:
- **Concurrent calls could pass together:**
  - The counter read the day count, then wrote it back; two calls at once could both pass.
  - Inside the Durable Object, input gates prevent this. The in-memory counter didn't.
  - `SpendCounter` now queues its calls. Test 79 runs 10 at once against a limit of 3 and expects
    exactly 3.
- **Production fell back to the in-memory counter when the binding was missing.** It now
  refuses, as above.

Also fixed:
- The response body is released when the Durable Object answers with an error.
- The Durable Object logs storage failures before answering 500.
- The docs now state the minute-limit bound after a restart.
- Test 79 restores `SPEND_CAP_GEMINI`.
- Limits must be safe integers.

Declined:
- **Moving `getBindings` to its own module:** the `cloudflare.ts`, `usage.ts` and `spend-cap.ts`
  imports only meet inside functions, so the cycle is safe as is.

