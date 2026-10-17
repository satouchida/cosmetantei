# Plan: limit AI ratings per Gemini call, and keep a share of the per-minute cap for chat

Written 2026-10-17. Status: step 2 done on 2026-10-17 (before the AI ratings shipped); steps 0, 1 and 3 are the next task.

## Why

AI ratings for unrated ingredients (`evaluateUnknownIngredients` in
`src/lib/services/dynamic-ingredient-service.ts`) make one Gemini call per ingredient. That keeps
one planted name from changing other ingredients' shared ratings, but it changes how the two
limits behave:

1. **Per-client rate limit counts requests, not Gemini calls.** `/api/analyze` with `aiEvaluate`
   takes one token from `AI_RATE_LIMITER` (20 per minute per IP), and one request can make up to
   20 new Gemini calls (`MAX_NEW_EVALUATIONS_PER_REQUEST`). So one IP can cause up to 400 calls a
   minute. Each name is paid for once (then saved, or remembered as failed), and only products the
   server holds are sent, so repeated abuse needs new products. But the limiter doesn't say what it
   seems to say.
2. **The global per-minute cap is shared by everything.** `SPEND_PER_MINUTE_GEMINI` (60) counts
   every Gemini call in the Durable Object `SPEND_CAP`: chat replies, page reads, translations,
   explanations and ratings. One product with many new ingredients can use 20 of the 60 at once,
   and a few of them together can make chat replies fail with 「capped」 for the rest of the
   minute. Ratings aren't urgent and the card can wait; chat replies are what the user is looking
   at.

The dollar budget (`SPEND_BUDGET_USD`, $30 a day and $100 a month) already bounds the money in both
cases. This plan is about fairness and keeping chat working, not about cost.

## Step 0: measure first

Before tuning numbers, query the `cosmetantei_usage` Analytics Engine dataset for a week after the
ratings ship:

- Gemini calls per minute by `task` (`ingredient_evaluate` against `chat_reply`, `page_read` and
  the rest), as the peak and the 99th percentile;
- how often `outcome = capped` happens, and for which task;
- `ingredient_evaluate` calls per analysis, and how quickly the cache hit rate rises (common oils
  and waxes should stop costing anything after a few days).

If the peaks stay far below 60 and there are no `capped` chat replies, step 2 can wait. Step 1
should be done either way, because it closes a gap rather than tuning a number.

## Step 1: count Gemini calls per client, not requests

Add a second rate limit binding that counts AI rating calls per client:

```toml
[[ratelimits]]
name = "AI_EVAL_RATE_LIMITER"
namespace_id = "1003"
simple = { limit = 40, period = 60 }
```

- **Where it's used:** in `evaluateUnknownIngredients`, before each new Gemini call (not for
  cache hits). `/api/analyze` passes the client key from `getClientIp`. Cloudflare's limiter has no
  cost parameter, so one `limit()` call means one Gemini call.
- **When the limit is reached:** stop asking, keep what was already rated, and return as now when
  the per-request cap is reached. The remaining ingredients are rated the next time the analysis
  is opened. Don't show a failure message; the card already lists the rated ingredients.
- **The request token stays:** `AI_RATE_LIMITER` still takes one token per `aiEvaluate` request,
  only for products the server holds (as now).
- **Fallback:** add `ai_eval: 40` to `FALLBACK_LIMITS` in `src/lib/server/cloudflare.ts`, so
  `next dev` and tests behave the same.
- **The 「AIでさらに詳しく調べる」 button:** it stays on `AI_RATE_LIMITER` only. It is one call per
  press.
- **Tests:** with a fake limiter that allows 3, a product with 10 new names makes 3 calls, returns
  those 3 ratings, and the next analysis rates 3 more. Cache hits don't take tokens.

## Step 2: keep a share of the per-minute cap for chat (done 2026-10-17)

Done more simply than planned below: a background call compares the same per-minute count with a
smaller limit (`perMinute × SPEND_BACKGROUND_SHARE`) in `reserveSpend`, so the Durable Object
didn't change. `GeminiRequest.background` is set for `ingredient_evaluate` and
`ingredient_translate`; the setting is `SPEND_BACKGROUND_SHARE` in `[vars]` (0.5); test 88.
The original plan:


Give Gemini calls a priority, and let background work use only part of each minute.

- **`reserveSpend`:** in `src/lib/server/spend-cap.ts`, add an option
  `{ priority: 'background' }`. `callGemini` passes it for `ingredient_evaluate` and
  `ingredient_translate`. `GeminiRequest` gets a `priority` field; everything else stays
  interactive.
- **`SpendCounter.consume`:** in `src/lib/server/spend-cap-core.ts`, a background call is refused
  when this minute's Gemini count has already reached `perMinute × BACKGROUND_SHARE`, while
  interactive calls can still use the whole minute. It is still one counter, so the overall cap
  doesn't change. The Durable Object's request body gains `priority`, and its validation
  (`isSpendLimits` and the rest) accepts it.
- **Setting:** `SPEND_BACKGROUND_SHARE` in `[vars]`, defaulting to `0.5`, so background
  work can use 30 of the 60.
- **What the user sees:** a refused background call counts as a transient failure (remembered for
  one minute, as now). The card shows what was rated, and the rest are rated on the next view.
- **Tests:**
  - in the memory store, with `perMinute` 10 and share 0.5, 5 background calls pass, the 6th is
    refused, and interactive calls still pass up to 10;
  - the Durable Object path accepts and checks `priority`;
  - test 79 (the strict spend cap) still passes.

## Step 3, only if step 0 shows it's needed: raise or smooth

- **Raise the cap:** if real peaks sit near 60 with step 2 in place, raise `SPEND_PER_MINUTE_GEMINI`.
  The dollar budget still bounds the money, and Gemini's own rate limit for the key is far higher.
- **Smooth it:** if bursts from ratings are still a problem, move ratings to a Cloudflare Queue
  consumer that works at a fixed rate, with the card asking again after a few seconds. This is a
  bigger change (a queue binding, a consumer and polling in the card), so only do it if the
  numbers call for it.

## Not changing

- **One ingredient per call stays.** Going back to batches would reopen the problem of one name
  steering other ingredients' shared ratings.
- **The dollar budget and its Durable Object stay as they are.**
- **Typed labels are still never sent to Gemini in bulk.**

## Done when

- an IP can cause at most 40 rating calls a minute (step 1);
- rating calls can never take more than half of a minute's Gemini calls (step 2, done);
- chat replies aren't refused with `capped` while ratings are running (checked in the usage dataset
  after a week);
- tests for both, and `docs/PROGRESS.md` updated.
