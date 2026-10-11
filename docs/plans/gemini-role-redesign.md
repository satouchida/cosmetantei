# Plan: Gemini as a web-research tool, using Cloudflare Web Search API

Rewritten 2026-10-09. It applies on top of the uncommitted Clef chat gate
(`src/lib/services/chat-gate.ts`). It replaces the earlier draft that relied on Google Search
grounding.

## Why not Google Search grounding

The [Gemini API terms](https://ai.google.dev/gemini-api/terms) for Grounding with Google Search
require four things for "Grounded Results":
- show them only to the user who asked;
- show them together with Google's Search Suggestions;
- don't modify them or mix other content into them;
- don't "cache, frame, syndicate, resell, analyze … or otherwise learn from" them, or build a
  database from them.

This app extracts ingredient lists from search results, analyzes them, and shares cached results
between users. That doesn't fit those terms, so **Google Search grounding is removed entirely**.
That includes the `googleSearch` tool in today's product discovery and chat replies, and the KV
caches that hold grounded output. (This is my reading of the terms, not legal advice.)

## The rule

Gemini is not a chat partner. It only does these tasks:

| Task | Source of facts | If the facts can't be confirmed |
|---|---|---|
| T1. Look up a product (name, brand, barcode) and its ingredient list | Cloudflare Web Search results, then Gemini reads the pages | Keep the product name only; ingredients 「成分未確認」 |
| T2. Explain the likely cause after the comparison | The app's own analysis plus general ingredient facts | n/a |
| T3. Find similar products without the culprit ingredients | Web Search, then Gemini reads the pages | **No alternatives shown** |
| T4. Where to buy a product cheaper | Web Search, then Gemini reads the pages | **No price answer**, Amazon link only |
| T5. Explain a single ingredient (「AIでさらに詳しく調べる」) | General ingredient knowledge (no web) | n/a |
| T6. Short summary of results (T1–T4) in the chat | Results only | Code-built text |

**Never:** free conversation, or anything about the user's own skin, symptoms, treatment or
medicine. **Clef decides this** (see the gate below). These get a fixed reply with no Gemini call.

## Cloudflare Web Search API

Docs: [How to use](https://developers.cloudflare.com/web-search/how-to-use/),
[Providers](https://developers.cloudflare.com/web-search/providers/).

**The call:**
- From the Worker: `env.AI.websearch({ query, provider, limit, gatewayId })`. It uses the existing
  `AI` binding, so no API token is needed.
- It returns `{ items: [{ url, title, description }], metadata }`, with at most 10 results.
- It always goes through AI Gateway (`cosmetantei-prod`, or `cosmetantei-dev` locally).

**Providers:** `exa` is primary; on an error or zero results, retry once with `linkup`. Ceramic,
the default, is not used.

| Provider | List price | Zero data retention | Description field |
|---|---|---|---|
| Exa | $7.00 / 1,000 searches | **No** (Exa keeps queries) | query-relevant highlights |
| Linkup | $5.00 / 1,000 searches | Yes | text snippets |

**Billing:** through AI Gateway credits (Unified Billing), or with our own Exa/Linkup keys stored
as gateway Provider Keys. Decision needed.

**Privacy:** search queries are built by the app from product names, ingredient names and
categories. **The user's chat message is never sent as a search query**, because Exa doesn't
offer zero data retention.

## Getting ingredient lists from pages

Search descriptions are highlights or snippets and usually don't contain a full ingredient list.
So for T1, T3 and T4:
1. Web Search returns up to 10 results. The app picks the top 2–3 pages, preferring official
   brand sites and major retailers.
2. Gemini reads those exact URLs with the
   [URL context tool](https://ai.google.dev/gemini-api/docs/url-context) (supported on
   gemini-3.8-flash, up to 20 URLs per request). It returns JSON in which every product, ingredient
   list and price carries the URL it came from.
3. **Code checks the sources:** the cited URL must be one of the search results and must appear
   in Gemini's URL-retrieval metadata as successfully read. Anything that fails is treated as
   unconfirmed (the right column above).
4. Every result is shown with its 「出典」 links.

`googleSearch` is never enabled together with URL context, so Google's grounding terms don't
apply.

## Chat gate changes (Clef, enforce mode)

The `scope` question gets four options:

| Scope | Meaning | Reply |
|---|---|---|
| `in_scope` | Product research: look up, cause, alternatives, prices, ingredient facts | Route by intent |
| `free_conversation` | Small talk, unrelated topics, general chatting | Fixed reply: what the app can do |
| `injection` | Attempts to override instructions or extract the system prompt | Fixed refusal |
| `personal_medical` | The user's own skin, symptoms, treatment or medicine | Fixed reply: see a dermatologist, plus an offer to find the cause by comparing products |

The `intent` question changes to these options:
- `product_lookup` (T1)
- `find_cause` (comparison, then T2)
- `find_alternative` (T3)
- `price_inquiry` (T4)
- `ingredient_question` (T5)
- `greeting_or_help` (fixed usage text)

Refusal thresholds stay as they are: summed non-in-scope probability ≥ 0.8, or jailbreak phrases.
`personal_medical` uses the same threshold.

**The gate switches from `shadow` to `enforce`.** The keyword fallback can't recognize personal
medical questions, so the rule only holds with Clef deciding.
- When Clef is unavailable, the keyword fallback applies, but it now routes to fixed replies or
  T1, never to a free Gemini reply. A free reply no longer exists.
- The gate cache key bumps to `gate:v3`.

## Storage and caching (by provider terms)

Decided 2026-10-09 after reading both providers' terms. This is not legal advice.

**Exa terms:**
- §1.2(c): Exa gets a perpetual license to queries ("User Input") and results ("Output"), so
  never send user text or personal data.
- §4.2(a): no copying, reproducing, displaying, distributing or creating derivative works from
  "any information … obtained from … the Services", except temporary browser caching or what the
  docs or a written permission allow.
- §4.2(j): no automated extraction or collection of data from the Services.
- §7.1.2: Output is not for medical advice.

**Linkup terms:** web content only for text and data mining, kept only as long as needed, and not
distributed.

**Policy:**
- Search results (from Exa or Linkup) are used only as a **short-lived list of URLs to read**.
  They are **never cached**: not in KV, and not in the AI Gateway cache (keep caching off for web
  search).
- Facts come from the **source pages** Gemini reads (brand and retailer sites), not from the
  providers' output. The extracted facts (product name, brand, category, ingredient list, source
  URL) may be cached in KV for up to 7 days.
- Prices are never cached.
- Open Beauty Facts data and user-entered labels are cached as today.
- Existing KV entries from Google-grounded discovery (`search:v1`, AI barcode results) are dropped
  by bumping their key prefixes.

## Billing (decided)

**Billing:** AI Gateway credits (Unified Billing). Reasons:
- one bill;
- no separate Exa or Linkup accounts and keys;
- searches at list price with no markup (5% fee on buying credits).

**Limit:** credit-billed requests are capped at 200 per minute per gateway. Switch to stored
provider keys (BYOK) if traffic approaches that.

Caching was not a reason to choose credits: caching search output is not allowed (see above).
Repeat lookups are saved by the KV cache of page-derived facts instead.

## Cost per request (estimates)

| Path | Calls |
|---|---|
| Product lookup (T1) | 1 Exa search ($0.007) + 1 Gemini call reading 2–3 pages (the page text counts as input tokens, possibly 10k–40k tokens) + T6 summary |
| Alternatives (T3) / price (T4) | Same shape as T1 |
| Cause (T2), ingredient (T5), summary (T6) | 1 short Gemini call, no tools, thinking `low` |
| Free conversation / medical / injection | 1 Clef call, nothing else |

Free chat replies, today's most frequent Gemini call, disappear. The KV cache of extracted facts
avoids repeat searches.

## Phases

0. **Live check (a handful of calls):**
   - Exa and Linkup on Japanese product queries (e.g. 「キュレル 潤浸保湿 化粧水 全成分」);
   - Gemini URL context on 2–3 Japanese retailer or brand pages;
   - check result relevance, whether full ingredient lists are extracted correctly, the
     URL-retrieval metadata, and token counts.
   - Adjust query templates before building.
1. **Gate:** new scopes and intents, enforce mode, fixed replies (`gate:v3`).
2. **`web-research.ts`:**
   - `webSearch()` (Exa, then Linkup fallback, via `env.AI.websearch`);
   - `readPages()` (Gemini plus URL context, JSON with per-item source URL, source checks);
   - T1 replaces `generateCosmeticsWithGemini` and the barcode AI fallback.
3. **T3** alternatives (`alternatives-service.ts`), with code re-checking the culprits.
4. **T4** prices (`price-service.ts`), never cached.
5. **T2 / T6:** `summarizeResults()` replaces `generateGeminiChatResponse` and the chat system
   prompt. Strict prompt: results only, no skin advice, 100–250 characters. T5's prompt is
   limited to general ingredient facts.
6. **Remove Google grounding:** the `grounding` option, `googleSearch`, and the
   grounded-output caches.
7. **UI:** 「出典」 links on product, alternative and price cards; a price card; the web-search
   label on AI alternatives.
8. **Tests for each task,** especially:
   - unconfirmed sources lead to no ingredients, no alternatives and no prices;
   - Exa failure leads to the Linkup fallback;
   - medical, free-talk and injection messages make no Gemini or search call;
   - user text is never sent as a search query.

## Phase 0 result (2026-10-11): passed

**Web search:** 8 searches, all 200 OK in 2–3.6 s.
- Exa returned **official brand pages** (Kao, Chifure, with the full ingredient table on Chifure's
  page) and @cosme.
- The alternatives query found real fragrance- and alcohol-free toners (Chifure, MUJI, FLAT TOKYO,
  Noevir).
- The price query found kakaku.com (¥1,192〜, 10 stores) and Yahoo! Shopping.
- Linkup returned OZmall, Tomod's, AEON and LIPS, usable as a fallback.

**Page reading:** Gemini with URL context read Kao's キュレル Ⅲ page and Chifure's 美白化粧水 W page
(both `URL_RETRIEVAL_STATUS_SUCCESS`).
- It extracted all 15 and 16 ingredients in label order, each with its source URL.
- Cost: 13,548 tool-use input tokens for 2 pages (about 6.8k per page). Time: 10.7 s.

`env.AI.websearch` requires wrangler ≥ 4.149. The project now has wrangler 4.149.0, from the
dependency upgrade made on 2026-10-10.

## Phase 1 status (2026-10-11): done (`430fe1a`, quick replies in `9fb3b1e`)

- Scopes and intents as above, with enforce as the default and fixed replies (`GATE_REPLIES`).
- Quick-reply buttons have an explicit intent table.
- **Deviation from "same threshold":** `personal_medical` also stops when it is Clef's top choice
  at ≥ 0.5. Answering a medical question by mistake is worse than a false stop, which still offers
  the product comparison.
- The keyword fallback only flags medical phrasing in context (「処方された」「皮膚科に」「治らない」).
  Product claims like 「低刺激処方」「アトピー肌向け」「皮膚科医監修」 are not flagged.
- Until Phase 2: any request with text is gated, whatever the `action`; an unreadable button
  action gets a fixed reply; and a product lookup with no matching products gets a fixed reply
  instead of a Gemini answer.
- **Still pending (Phase 2):** product search still sends the user's text to the current
  Google-grounded discovery. Phase 2 replaces it with Web Search queries built from product names
  only.
- The build failure from the 2026-10-10 dependency upgrade was fixed in `75c66d2`.
- Quick-reply buttons are now handled in the browser (`9fb3b1e`); only two labels skip Clef.

## Phase 0 status (2026-10-09)

- **Blocked:** the first Exa search returned `402 web_search_payment_required`, because no AI
  Gateway credits are loaded. No searches ran.
- **Wrangler version:** `env.AI.websearch` is not available in the project's wrangler 4.127.1.
  It works with wrangler 4.149.0.
  - The project's `wrangler` devDependency must be upgraded before implementation.
  - `compatibility_date` may also need updating.
- **Japanese quality:** Phase 0 still has to show that Exa and Linkup return useful Japanese
  product pages. If they don't, the fallback order or the providers may need to change.
