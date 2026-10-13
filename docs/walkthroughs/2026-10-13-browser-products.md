# Walkthrough: products sent from the browser (2026-10-13)

Resolves "Don't trust product objects from the browser" in
[03, Security and data trust](../review/03-other-upgrades.md#security-and-data-trust).

## What was found first

Before changing anything, every path a browser-sent product takes was traced. The original worry
(product text going into Gemini prompts) no longer applied:

| Where a sent product goes | What it can affect |
|---|---|
| Single analysis, comparison (`analyzeProduct`, `performDifferentialAnalysis`) | Only the sender's response |
| The cause reply (`explainCulprits`) | Gemini gets only ingredient-DB facts for DB matches. Sent ingredient text and product names never reach the prompt |
| Alternatives | Search words come only from DB names and fixed words |
| Price button (`productSearchQuery`) | A paid web search on the product name, after `toProductSearchQuery`. The same as typing a price question |
| Shared caches (KV, the in-memory product cache) | Nothing. Every writer takes only products the server fetched itself |

**What remained:**
- A browser could send a real product's ID with edited ingredients or names, and the server used
  them.
- One shared in-memory cache did keep text from the request (below).

## What changed

- **`src/lib/server/client-products.ts`:**
  - when the server holds a verified, shareable product with the same ID, the chat and analyze
    routes use the server's copy: its name, ingredients and source;
  - otherwise they use the sent product: labels the user typed (never stored, by design),
    products the server has no ingredients for, and products that have fallen out of its cache.
- **Hydration race (`hydrateVerifiedProducts`):**
  - the "loaded" mark was set before the KV read finished, so a second request on a cold isolate
    went ahead with an empty product list;
  - that defeated the lookup, and could trigger paid web research for alternatives;
  - the mark is now set after the read.
- **Rule-generated ingredient explanations are no longer cached** (`dynamic-ingredient-service.ts`).
  They carried the first caller's spelling of the name, which other users then saw. Generating
  them is cheap and depends only on the name. Matches to the ingredient DB are still cached.
- **`/api/analyze` is rate-limited** with the search bucket. It does CPU work only; the UI does not
  call it.

## Tests

- **71:**
  - a forged product with a real ID is analysed, compared and priced as the server knows it, in
    both routes;
  - a server product without ingredients keeps the sent label;
  - an unknown product is analysed as sent;
  - an injection string in a sent ingredient never reaches a Gemini prompt;
  - sent products never reach the shared product cache or KV;
  - the alternatives path is covered too.
  - It fails if the server lookup is removed (checked).
- **13 (updated):** only DB matches are cached; each caller sees their own spelling.

## Code review

`code-improver` confirmed the trace above (it checked that `cachedShortReply` caches only the
model's text, never the fallback, which holds sent culprit names). No Critical or High issues.
Fixed:
- **Medium:** the hydration race.
- **Low:**
  - the cached rule entries;
  - a defensive `isShareable` check on the server copy;
  - the missing rate limit on `/api/analyze`;
  - test gaps (`/api/analyze`, a server copy without ingredients).

Not added: a test for the cold-isolate race itself. The module-level timestamp is shared across
the test run.

Left for the audit of `dynamic-ingredient-service.ts` (Next in PROGRESS): `/api/ingredients/explain`
puts a client-chosen name into the Gemini prompt and caches the answer for 30 days. The cache key
is the name itself, so one name cannot change another's entry. Quoting the name as data, as the
price prompt does, would harden it.
