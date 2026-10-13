# Plan: Clef chat gate and search result filter

Written 2026-10-08, against commit `767e52d` plus the uncommitted brand check (`src/lib/services/brand-check.ts`).

## Model choice, per feature

Sources:
- **Jev Decision Index v0.3** (independent, Hugging Face Space `multimodalart/jev-decision-index`,
  data generated 2026-10-07). It covers 114 models on 42 benchmarks, all in English.
- **Cloudflare's Clef evals page** (`clef-evals.workers-ai-mle.workers.dev`, generated 2026-10-01).
  It is built on Decision Index 0.2.1 data and run by the vendor.

The two sources agree on every number below.

| | `clef` (27.8B) | `clef-flash` (9.65B) |
|---|---|---|
| Overall rank (Cloudflare page / HF index) | 1st of 73 / 18th of 114 | 5th of 73 / 30th of 114 |
| Median latency, all benchmarks (Cloudflare / HF) | 209 ms / 102 ms | 39 ms / 53 ms |
| Price | $0.24 per M input tokens | $0.09 per M input tokens |
| **CLINC150**: route a short request to 1 of 150 intents, or "out of scope" | **0.974** macro-F1, 1st of 106, median 593 ms | 0.669, 73rd of 106, median 372 ms |
| BANKING77: intent, 77 classes | 0.941 | 0.908 |
| **Amazon ESCI**: product is exact / substitute / complement / irrelevant to a shopping query | **0.574** macro-F1, 8th of 114, median 104 ms | **0.574**, 7th of 114, median 78 ms |
| When2Call: answer, call a tool, ask, or decline | 0.725 | 0.653 |
| PhishNChips: phishing or legitimate | 0.794 | 0.751 |

**Decisions:**
- **Chat gate → `clef`.** CLINC150 is almost exactly this task: intent plus out-of-scope
  detection on short user messages. `clef` is the best model in the index on it, and `clef-flash`
  loses about 30 points. A wrong gate decision either refuses a real cosmetics question or sends
  an off-topic one to Gemini, so accuracy matters more than about 0.2 to 0.5 s of latency on a
  reply that takes seconds anyway.
- **Search result filter → `clef-flash`.** Both models score the same on ESCI, which is this exact
  task. Flash is about 25% faster on ESCI and 62% cheaper, and the filter runs on type-ahead
  searches.
- **Brand check → stays on `clef`.** It runs only for brands never seen before, and a wrong verdict
  is cached for 90 days.

**Caveat: none of these benchmarks are Japanese.** Both Clef models are fine-tuned from Qwen base
models (which are multilingual), but their accuracy on Japanese cosmetics text is unmeasured.
Phase 0 below measures it before either feature is switched on.

---

## Phase 0: Japanese evaluation sets (before enabling anything)

- `tests/evals/chat-gate.jsonl`: about 120 labelled messages:
  - in-scope questions, including tricky ones that the old regexes got wrong
    ("Dandelion extract は？", "ピリピリする化粧水", "redundant な成分");
  - off-topic messages (coding, translation, politics, homework);
  - Japanese and English prompt injection;
  - greetings;
  - the app's fixed quick-reply strings.
- `tests/evals/search-filter.jsonl`: about 30 queries × the candidate products the app actually
  returns, each labelled exact / substitute / complement / irrelevant.
- `scripts/eval-clef.ts`: runs both sets against `clef` and `clef-flash` through the Workers AI
  REST API, using the logged-in wrangler account, and prints per-class precision/recall and
  latency. Cost: well under $0.01 per full run.

**Acceptance bar:**
- Chat gate:
  - in-scope recall ≥ 99% (false refusals are the worst outcome);
  - out-of-scope precision ≥ 95%;
  - intent macro-F1 ≥ 0.85.
- Search filter: "irrelevant" precision ≥ 95%. Wrongly hiding a real product is worse than
  showing a weak match.
- If a model misses the bar, keep that feature on the current heuristics or try the other model.

## Phase 1: chat gate (`clef`)

**Status (2026-10-11): running in `enforce` mode** (`CHAT_GATE_MODE` in `wrangler.toml`), with the
scopes and intents from `docs/plans/gemini-role-redesign.md`. It shipped in `shadow` mode on 2026-10-09.
Phase 0 was skipped by decision. A live check of 5 messages through the dev gateway classified all
correctly: an ingredient question the old filter used to block; a coding request; a Japanese jailbreak
the old filter missed; a product lookup; a skin-concern question. Each took 100–600 ms and about
490 input tokens.

Changes from the plan, from review and live testing:
- A refusal counts the summed non-in-scope probability. Jailbreak phrases (English and Japanese)
  are refused even if Clef says in-scope.
- The Clef call has a 3 s timeout, then falls back to the heuristics.
- Quick replies keep the old keyword routing (no Clef call).
- Button actions skip the gate.
- A Clef `find_cause` with no products added gets general advice instead of the "add products"
  prompt.
- Gate requests carry the user's message, so they go through AI Gateway only when payload logging
  is allowed (`AI_GATEWAY_LOG_PAYLOAD=true`, the dev gateway). In production they call Clef
  directly, so chat text is never stored in gateway logs.
- To review shadow results, filter the Workers logs for `"event":"chat_gate_shadow"`. Each entry
  has the heuristic decision, the Clef verdict and what enforce mode would have done; it never
  contains the message text.

**New file:** `src/lib/services/chat-gate.ts`
```ts
type GateDecision = {
  scope: 'in_scope' | 'out_of_scope' | 'injection' | 'unknown';
  intent: 'greeting_or_help' | 'product_lookup' | 'ingredient_question'
        | 'skin_concern' | 'find_cause' | 'other_cosmetic' | 'unknown';
  source: 'quick_reply' | 'clef' | 'heuristic';
};
export async function classifyChatMessage(message: string): Promise<GateDecision>
```

**Order of checks** (same pattern as the brand check):
1. **Fixed quick-reply strings** (`🔍 別のコスメを調べる`, etc.) are mapped to an intent from a table.
   These are free, and they are a large share of real traffic.
2. **Cache:** the normalised message hash is stored in KV for 1 day.
3. **One Clef request with two `choice` questions:**
   - `scope`: in_scope / out_of_scope / injection. The criteria describe cosmetics, skincare, skin
     trouble, ingredients and using this app.
   - `intent`: the six intents above.
   Both answers come from the same call; Clef allows up to 64 questions per request.
4. **Fallback:** if Clef is unavailable or below the thresholds, use the existing heuristics:
   - `isCosmeticTopicRelevant`, `isGreetingOrConsultation`;
   - the `比較 / あぶり出し / 原因特定` keywords;
   - the `KNOWN_INGREDIENTS` substring check.
   These stay in the code as the fallback; they are not deleted.

**Thresholds:**
- Refuse only when `out_of_scope` or `injection` has probability ≥ 0.8. Anything less goes through
  normally, and Gemini's system prompt still guards the topic.
- Route by `intent` when its probability is ≥ 0.6; otherwise use the heuristic route.

**Wiring in `src/app/api/chat/route.ts`:**
- Run the gate only for free-text messages. Button actions (`analyze_single`, `differential`,
  `barcode_lookup`) and pure barcode numbers skip it.
- Run it after rate limiting and validation, before `searchCosmeticsLive` and any Gemini call.
  Off-topic messages then cost one Clef call instead of a grounded Gemini search plus a Gemini reply.
- Replace the keyword routing with `intent`:

  | Intent | Branch |
  |---|---|
  | `find_cause` | differential branch |
  | `ingredient_question` | ingredient branch |
  | `greeting_or_help` | greeting branch |
  | everything else | general branch |

**Rollout:**
1. **Shadow mode first.** Log `{heuristic decision, Clef decision, probabilities}` for every
   message, but keep acting on the heuristics. Compare for about a week of real traffic.
2. Then switch with `CHAT_GATE_MODE=enforce` (`off | shadow | enforce`, default `shadow`).

**Cost:** roughly 500 to 800 input tokens per message, about $0.0002 on `clef`, and zero for
quick-reply buttons and cached messages. Each off-topic message avoids a grounded Gemini search
and a Gemini reply.

**Latency:** adds about 0.2 to 0.6 s before the Gemini reply. The CLINC150 median for `clef` is
593 ms (HF index). It cannot run in parallel with the search, because skipping that search is the
point.

**Tests:** fake `AI` binding, as in the brand-check tests:
- out-of-scope is refused with no Gemini fetch;
- low confidence falls back to heuristics;
- quick replies make no Clef call;
- shadow mode does not change behaviour.

## Phase 2: search result filter (`clef-flash`)

**Status (2026-10-13): built, off by default** (`SEARCH_FILTER_MODE = "off"` in `wrangler.toml`).
See [the evaluation](#phase-2-evaluation-2026-10-13) below for why it is off.


**New file:** `src/lib/services/search-filter.ts`, called at the end of `searchCosmeticsLive`.
`/api/products/search` and the chat product suggestions both go through `searchCosmeticsLive`,
so both get the filter.

**One `clef-flash` request per search.** It has one ESCI-style `choice` question per candidate
(10 or fewer):
- `exact`: the product the user asked for;
- `substitute`: same type, could replace it;
- `complement`: related, different type;
- `irrelevant`: not a match, or not a cosmetic product.

The state includes the query and each candidate's brand, name and category.

**Policy:**
- Drop a candidate only if `irrelevant` has probability ≥ 0.75. ESCI macro-F1 is only about 0.57,
  because exact vs substitute vs complement is hard. The binary irrelevant / not-irrelevant
  decision is the part worth trusting.
- Order the rest exact > substitute > complement, keeping the current order within each group.
- Skip the filter for empty queries and greetings.

**Fallback:** if `clef-flash` is unavailable, use today's behaviour, i.e. the
`isActualCosmeticProduct` and `isNonCosmeticSearchQuery` regexes. Keep those regexes as a free
precheck. Simplify them only after Phase 0/1 data shows the filter covers what they catch.

**Cost and latency:**
- `/api/products/search` already caches results in KV for 1 hour, so the filter runs once per
  query per hour.
- `clef-flash` median on ESCI is 78 ms, which fits type-ahead.
- About 300 to 600 input tokens per search, about $0.00005.

**Tests:**
- irrelevant candidates are dropped only at ≥ 0.75;
- the result order follows the labels;
- no AI binding → results unchanged.

**As built** (`src/lib/services/search-filter.ts`):
- **`SEARCH_FILTER_MODE`:** `off` (default), `shadow` (log counts only, results unchanged) or
  `enforce`.
- **The call:** one `@cf/cloudflare/clef-flash` call per search (`CLEF_MODEL_FILTER` switches the
  model), at the end of `searchCosmeticsLive`, on at most the results that will be shown.
- **Policy:** as planned. Drop only `irrelevant` ≥ 0.75, then order exact > substitute >
  complement, keeping the original order within each group.
- **Never empty:** if every candidate would be dropped, the results are returned unchanged.
- **Failures:** a 1.5 s timeout. Any failure, incomplete answer or malformed cached value returns
  the results unchanged. A late answer still finishes after the response (`waitUntil`) and fills
  the cache.
- **Cache:** verdicts in KV for 1 day, keyed by a hash of the normalised query and the candidates.
  The model sees the same normalised query. Bump `sfilter:v1` when the question wording changes.
- **Short queries:** queries under 2 characters are not checked.
- **Privacy:** the query is user text, so the call goes through the AI Gateway only when payload
  logging is allowed. Shadow logs carry no query or product names.

**Fixed on the way:** each Clef model needs its own model ID plus the matching `model` value
(`@cf/cloudflare/clef` with `"clef"`, `@cf/cloudflare/clef-flash` with `"clef-flash"`).
`CLEF_MODEL_GATE=clef-flash` used to send `"clef-flash"` to `@cf/cloudflare/clef`, which the API
rejects ("Unsupported model 'clef-flash'"). That would have silently moved the gate onto the
keyword rules. The new `clef-models.ts` pairs them, and `CLEF_MODEL_BRAND` was added as the order of
work asked.

## Phase 2 evaluation (2026-10-13)

The eval set was the candidates the app actually returns. Two things were checked first:
- **Type-ahead** (`/api/products/search`, cached products plus Open Beauty Facts): 30 Japanese and
  English queries returned **1 product in total**. Open Beauty Facts has almost no Japanese
  products: 1 for キュレル, 0 for ちふれ. `nivea` took 2.3 s against the 2.5 s timeout.
- **Chat search with web research:** 20 queries returned 46 products, and **all of them matched
  the query** (the exact product, or a same-line variant). Web research already keeps only
  products that name the query.

`clef-flash` was then run on those results, plus planted candidates, with the plan's ≥ 0.75 rule:

| Candidates | Hidden |
|---|---|
| The app's real results (36, from 17 queries with results) | **0** (34 exact, 2 substitute) |
| A non-cosmetic (iPhone case, cup noodles), 2 per query | **34 of 34** |
| Another brand's cosmetic (from a different query) | 2 of 17 (mostly labelled substitute or below 0.75) |

Latency was 350–780 ms per call, with about 900–1,500 input tokens ($0.038 per million). The plan
assumed 78 ms.

**Decision:**
- The filter is safe: it hid no real result, and caught every non-cosmetic.
- It has nothing to remove from today's results, so it ships off.
- Switch on `shadow`, then `enforce`, if a looser source is added (e.g. a fuller type-ahead), or if
  shadow logs show drops.

**Code review (`code-improver`):** no Critical issues.

Fixed:
- **High:** a timed-out answer was cut off with the response and never cached, so a slow query
  waited 1.5 s every time. It now runs on after the response.
- **High:** enforce could return an empty list, and a malformed cached value could throw.
- **Medium:** the cache key was ambiguous (it joined with `\n` and `|`), and the model saw a
  different query from the key.

Partly applied:
- **Medium:** a call per type-ahead keystroke. Only the 2-character minimum was added, since the
  filter ships off and the type-ahead route caches results for 1 hour.

Not changed:
- **Low:** ordering by a single label.
- **Low:** unfenced product names. These can only promote a candidate, never hide a real one.

## Phase 3 (optional): product categories, decided against a separate Clef step

**What `Product.category` does today:**
- It adds synonym matches in the in-memory search (`searchCosmetics`).
- For a category query such as 「リップ」, it removes cached products whose category differs
  (`searchCosmeticsLive`, step A). Open Beauty Facts products are always `other`, so they never
  survive that filter.
- `findSafeAlternatives` ignores category entirely. A safe alternative to a toner can be a
  lipstick.

**Assessment:**
- Categories alone help the backend very little; they matter only in the two search spots above.
- The real user-facing value is **same-type alternatives**: "here is a fragrance-free toner"
  instead of any product without the culprit. That is worth doing, but categories are only useful
  together with that change.

**Plan, only if same-type alternatives are wanted:**
1. Change `findSafeAlternatives` to prefer the bad product's category, falling back to any
   category when none match.
2. Fill categories cheaply, in this order:
   - Open Beauty Facts' own `categories_tags` (e.g. `en:sunscreen`, `en:moisturizer`), when
     present. A sample search for "curel" had tags on 2 of 5 products.
   - Name keywords using the existing `CATEGORY_SYNONYMS`.
   - Only then, one extra `category` question in the Phase 2 `clef-flash` request (same call,
     marginal cost). Keep `other` when confidence is below 0.7.
3. Store the category with the verified product in KV, so each product is classified once.

**Do not** add a standalone Clef categorisation pass over products; it costs calls for little
benefit.

## Order of work

1. Phase 0 eval sets and script. Run them once and confirm the model choices on Japanese data.
2. Phase 1 in shadow mode, then enforce.
3. Phase 2.
4. Phase 3 only together with same-type alternatives.

Also add a `CLEF_MODEL_GATE` / `CLEF_MODEL_FILTER` / `CLEF_MODEL_BRAND` setting (default
`clef` / `clef-flash` / `clef`), so a model can be switched after re-running the evals without a
code change.
