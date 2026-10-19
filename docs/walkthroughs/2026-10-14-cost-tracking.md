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
- **Fields:** route, kind, task, model (or search provider), outcome (`ok`, `error`, `capped`, `cache_hit`, and since 2026-10-17/18 `recitation`, `blocked`, `truncated`),
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
  - **Day and month totals:** kept in its SQLite storage, so they survive restarts.
  - **The last 60 seconds:** kept in memory. After a restart (deploy, crash) the minute limit can
    be exceeded once, by up to its own size per kind. The budget still holds.
  - **Logic:** the counting is in `src/lib/server/spend-cap-core.ts` and has no Cloudflare
    dependencies, so test 79 runs it directly.
- **Limits:** a dollar budget for all paid calls together, plus a per-minute count for each kind.
  See [Budget](#budget) below. (The first version counted calls per day; the budget replaced it.)
- **When it applies:** `callGemini`, `runWorkersAI` and `runWebSearch` ask the counter before
  every call (`reserveSpend`).
  - **Over the limit:** the call is not made and is recorded as `capped`. Callers already
    handle a missing answer: fixed replies, 「見つかりませんでした」, or the chat gate's fallback.
  - **What counts:** every attempt reserves its estimate. Gemini calls are then settled to
    their real cost (below); other calls keep the estimate.
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
  - with a zero limit, the Clef call is skipped and recorded as `capped` (rechecked with the
    budget below).

## Budget

The owner's budget is about **$30 a day and $100 a month**. The cap counts dollars, not calls, so
the same limit holds whatever mix of calls users make.

- **Setting:** `SPEND_BUDGET_USD = "30/100"` in `[vars]`: per UTC day / per UTC calendar month,
  for Gemini, Workers AI and web search together. Decimals are allowed (`"2.5/40"`).
- **Both limits apply.** At the full daily rate, the month's $100 is used up in a little over three
  days; paid calls then stop until the 1st (UTC) and users get the usual fallbacks.
- **Per-minute counts**, per kind, stop sudden bursts: `SPEND_PER_MINUTE_WEB_SEARCH = "30"`,
  `SPEND_PER_MINUTE_GEMINI = "60"`, `SPEND_PER_MINUTE_WORKERS_AI = "120"`.
- **Not in the budget:** fixed fees, such as the Workers Paid plan, and Durable Object, KV and
  Analytics Engine use. Lower the budget by those if they should come out of the same $100.

### Reserve, then settle

1. **Before the call,** the caller reserves a high estimate. If today's or this month's total plus
   the estimate would pass the limit, the call is not made.
2. **After the call,** Gemini calls are settled to the real cost from `usageMetadata`. The
   difference is added to or taken from the totals of the day and month the call was reserved
   in. If the day has changed by then, only the month total is corrected.

| Kind | Estimate | Settled |
|---|---|---|
| Gemini | characters of prompt, system text, history and schema counted as tokens (Japanese is about one token per character or less), 2,000 tokens per image, 20,000 tokens per page read with URL context, and the full `maxOutputTokens` (thinking counts toward it) | yes: input (page text included) − cached at the input price, cached at the cache price, output + thinking at the output price. A gateway cache hit or a 4xx reply (including 429) costs 0. A 5xx reply, a network error or a timeout keeps the estimate, because it may have been billed. |
| Workers AI (Clef) | characters of the input JSON counted as tokens, input price only | no (less than $0.001 a call) |
| Web search | the provider's list price + 5% | no |

**A page can be longer than its 20,000-token estimate.** Then the settlement takes the total past
the limit, by at most the overrun of the calls already running; the next calls are refused, and
the log says `Spend estimate was low`. All other estimates are upper bounds.

An unknown Gemini model is logged once (`No price for Gemini model`), and an estimate that is
not a number refuses the call.

A failed settlement is logged and the estimate stays.

### Prices

`src/lib/server/prices.ts`, checked 2026-10-15 (USD per million tokens):

| | Input | Cached input | Output | Source |
|---|---|---|---|---|
| `gemini-3.8-flash` to 2026-12-31 | 0.75 | 0.075 | 3.75 | [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), Standard, paid tier |
| `gemini-3.8-flash` from 2027-01-01 | 1.50 | 0.15 | 7.50 | same page; the table switches on the date |
| Other Gemini models | 5 | 5 | 30 | high on purpose; add the model to the table |
| `@cf/cloudflare/clef` | 0.24 | | none | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| `@cf/cloudflare/clef-flash` | 0.038 | | none | same |
| Other Workers AI models | 2 | | 10, for 1,000 tokens | high on purpose; they may bill output |

Web search, per call: Exa $0.00735 and Linkup $0.00525. These are the list prices ($7 and
$5 per 1,000, [Gemini redesign plan](../plans/gemini-role-redesign.md)) plus the 5% fee on AI
Gateway credits ([Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)).
Gemini is billed by Google through the stored provider key, so it has no credit fee.

### What the budget buys

Estimates per call at 2026 prices (2027: Gemini about twice):

| Call | Reserved | Notes |
|---|---|---|
| Chat reply (`maxOutputTokens` 1,024) | about $0.005 | a real `ingredient_reply` on `wrangler dev` cost $0.0008 (306 in, 141 out) |
| Product page read (3 pages, 8,192 out) | about $0.08 | |
| Price page (1 page, 2,048 out) | about $0.02 | |
| Label photo (4,096 out) | about $0.02 | |
| Clef check | under $0.001 | |
| Web search | $0.005–0.007 | |

So even at the reserved prices, $30 a day covers about 350 product lookups (search + page read),
or about 5,000 chat replies. Real costs are lower, and settlement returns the difference.

### Checks

- Test 79: the per-minute count per kind; the day and month limits on the total; settlement,
  including after the day changes; the totals surviving a re-created Durable Object; 400 for bad
  requests; reading `SPEND_BUDGET_USD` and `SPEND_PER_MINUTE_*`; the price table's 2027 step; the
  Gemini estimate and real cost.
- Test 78: a Gemini call reserves, then settles with a negative difference; a network error
  keeps the estimate; the web search reserves $0.00735.
- `wrangler dev` with the real Durable Object:
  - normal budget: Clef and Gemini calls are made and settled, with no settlement errors;
  - `--var SPEND_BUDGET_USD:0/0`: the Clef gate and the Gemini reply are skipped and recorded as
    `capped`, and the reply falls back to the ingredient database.

### Review of the budget

`code-improver` found nothing Critical or High, and confirmed the unit maths. Fixed:
- **Medium:** every non-OK Gemini reply settled to 0. A 5xx or gateway timeout can come after
  Google has billed the answer, so only 4xx replies are settled to 0 now (test 78).
- **Medium:** an estimate that was too low passed silently. It is now logged.
- **Low:** a cost that is not a number refuses the call, instead of turning the in-memory totals
  into NaN.
- **Low:** an unknown Workers AI model now also reserves 1,000 output tokens.
- **Low:** an unknown Gemini model is logged once.
- **Low:** a stale comment in `wrangler.toml`.
- **Tests:** settlement for a cache hit, a 429 and a 503; a cost equal to what is left of the
  budget is allowed.

Declined:
- **A longer timeout for `/consume`, or a request id to retry it:** a timeout refuses the call and
  may leave its reservation counted, which errs on the side of spending less. A longer timeout
  would make users wait longer when the Durable Object is slow.
- **Refusing at 95% of the budget:** an overrun only comes from pages longer than their
  estimate, in calls that are already running, so it is small next to $30. Holding back 5% would
  cost $1.50 every day. The log line shows when the page estimate should be raised.

### Also possible

AI Gateway has its own [spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)
per gateway. They could be a second guard for Gemini and Workers AI. They are not set up here.

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

## Update 2026-10-18: per-client budget, failure markers, new outcomes

- **Per-client daily budget:** every paid call made inside an API request is also charged to the
  client (the IP from `cf-connecting-ip`; IPv6 grouped by /48), up to `SPEND_PER_CLIENT_USD`
  ($0.50) per UTC day. The Durable Object stores it as `client:<day>:<ip>`, keeps a read-through
  copy in memory, and deletes earlier days' keys (128 at a time) on the first paid call of a new
  day. Settling adjusts the client's total too. A value of `"0"` refuses every client call; it does
  not mean "unlimited". Calls outside a request (none today) are not charged to a client.
- **Background share:** ingredient ratings and translations may use only
  `SPEND_BACKGROUND_SHARE` (0.5) of each minute's Gemini count.
- **New outcomes:** `blocked` (a safety filter, or `promptFeedback.blockReason`), `truncated`
  (`MAX_TOKENS`) and `recitation`. All three were billed, so token counts are recorded. Other
  unexpected finish reasons are recorded as `error`.
- **Failure markers** (so a failure isn't paid for on every request): web research and barcode
  research 10 minutes; a translation with no response 30 minutes (an unusable answer marks the
  product untranslatable); an ingredient rating 1 minute with no response, 1 hour unusable, 1 day
  blocked or cut off. No marker is written in a request where the spend cap refused a call, so
  nobody can use the caps to mark popular searches as failed for everyone.
- **Price page offers** are reused for 15 minutes when every page was read; shop API prices are
  never stored. Price lookups are limited to 5 a minute per client (`PRICE_RATE_LIMITER`).


## Update 2026-10-18 (2): limits for one person using many IPs

The per-IP budget stops one address, but $30 ÷ $0.50 is only 60 IPs, and rented servers and
proxies are cheap. Three more limits, all checked in the same Durable Object call. A paid call is
refused if it would pass **any** of the client's limits:

| Key (stored as `client:<day>:<key>`) | When it's attached | Daily limit | Setting |
| --- | --- | --- | --- |
| `ip:<ip>` (IPv6 per /48) | always | $0.50 | `SPEND_PER_CLIENT_USD` |
| `net:<a.b.c>.0/24` | IPv4 only | $2 | `SPEND_PER_NETWORK_USD` |
| `asn:<number>` | the request comes from a cloud or hosting network (`request.cf.asn` is in `src/lib/server/hosting-networks.ts`) | $1 per network | `SPEND_PER_HOSTING_NETWORK_USD` |
| `sess:<id>` | a Turnstile-verified browser session | $0.50 | `SPEND_PER_CLIENT_USD` |
| `sess:<id>` (same key) | the session is less than `SPEND_NEW_SESSION_MINUTES` (30) old | $0.30 | `SPEND_PER_NEW_SESSION_USD` |

- **Tightening:** once today's global total reaches `SPEND_TIGHTEN_AFTER_SHARE` (0.5) of the day
  budget, every limit above drops to `SPEND_TIGHTENED_PERCENT` (30) %, so $0.50 becomes $0.15.
  Even a wide attack then leaves the second half of the day's budget spread over many users.
- **Turnstile** (`src/lib/server/session.ts`): when `TURNSTILE_SITE_KEY` is set, every `apiRoute`
  needs a signed `__Host-session` cookie (HttpOnly, Secure, SameSite=Strict, 24 hours; it holds
  only a random ID, the expiry and an HMAC-SHA256 signature made with `SESSION_SECRET`). Without
  one the route returns 401 with the site key before any work is done. The browser's `apiFetch`
  (`src/lib/client/api-fetch.ts`) solves Turnstile (usually invisibly), posts the token to
  `POST /api/session` (same-origin only, 10 a minute per IP, `SESSION_RATE_LIMITER`), and retries
  once. The server checks the token with Cloudflare's siteverify, including the action (`api`)
  and the hostname. If the site key is set but `TURNSTILE_SECRET_KEY` or `SESSION_SECRET` (32+
  characters) is missing, paid routes return 503. Cloudflare's test secret only works on
  localhost.
- **Not grouped:** home and mobile ISPs (no ASN cap), iCloud Private Relay and WARP exits, and
  IPv6 beyond /48. A busy carrier-grade NAT /24 shares $2, which is plenty at today's traffic.
- On deploy, today's per-IP totals start again from zero (the key changed from `<ip>` to `ip:<ip>`).

### Setting up Turnstile

1. Cloudflare dashboard → Turnstile → Add widget. Hostname: the production domain (and the
   `workers.dev` host if used). Widget mode: Managed.
2. Put the site key in `wrangler.toml` as `TURNSTILE_SITE_KEY`.
3. `pnpm exec wrangler secret put TURNSTILE_SECRET_KEY` (the widget's secret key) and
   `pnpm exec wrangler secret put SESSION_SECRET` (for example the output of
   `openssl rand -base64 48`). Set both secrets **before** deploying the site key, or paid routes
   return 503 until they are set.
4. Locally, use Cloudflare's public test keys:
   `wrangler dev --var TURNSTILE_SITE_KEY:1x00000000000000000000AA --var TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA --var SESSION_SECRET:<random>`.
