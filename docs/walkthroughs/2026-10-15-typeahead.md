# Type-ahead for Japanese products (2026-10-15)

Item 1 of Next in PROGRESS. The Phase 2 evaluation (2026-10-13) found that
`/api/products/search` returned 1 product for 30 Japanese and English queries.

## Why it found almost nothing

- **The route never loaded the products saved in KV.** Chat research stores every product with a
  verified ingredient list in KV (`verified-products:v1`, up to 300). The chat and analyze routes
  load them into memory; the search route didn't, so a new isolate searched an empty list and fell
  through to Open Beauty Facts.
- **Open Beauty Facts has almost no Japanese products** (1 for キュレル, 0 for ちふれ).
- **Matching was a plain substring test** on lowercased text. 「きゅれる」 did not find キュレル, half-width
  「ｷｭﾚﾙ」 did not either, and 「キュレル 化粧水」 (two words) matched only by brand.
- **The tray kept old candidates** when a new query found nothing.

## Sources considered

| Source | Used | Why |
|---|---|---|
| Products saved in KV (chat research, Open Beauty Facts) | yes | real products with sources; free; grows as people use the chat |
| Open Beauty Facts | yes, after the saved products | free, but few Japanese products |
| Rakuten / Yahoo! shopping APIs | no | keys are still pending; one call per second per app ID, shared by all users, while type-ahead calls on every pause in typing; listing titles are noisy (「【公式】…送料無料」); results may not be stored |
| Web search + Gemini | no | paid per call; type-ahead stays free (as decided in the Gemini redesign) |

## What changed

### Matching (`src/lib/search/product-match.ts`)

`searchKey` makes the text used for matching:
- accents removed (Curél → curel);
- NFKC: full-width letters and digits to half-width, half-width kana to full-width;
- lower case;
- hiragana to katakana (きゅれる → キュレル);
- spaces, 「・」, slashes, brackets and similar marks dropped. The long vowel mark 「ー」 is kept,
  because it changes the word.

Kanji is not read from kana: 「じゅんしん」 does not find 「潤浸」.

`rankProducts` keeps the products that match and orders them:

| Score | Match |
|---|---|
| 1000 | barcode |
| 400 | the product name starts with the query |
| 350 | brand + name starts with it |
| 250 | the name contains it |
| 220 | the query contains the name (a chat sentence such as 「キュレルの…を調べて」; names of 4+ characters) |
| 200 | brand + name contains it (「キュレル潤浸保湿」 typed without a space) |
| 120 | every space-separated word is in the brand, the name or the category's words (「ちふれ 乳液」 finds a cream) |
| 50 | the query contains the brand: the same brand's products, **only when nothing else matches**. A brand of only Latin letters and digits needs 3+ characters, so 「AB」 doesn't match inside other words |

- **Verified products first:** a product with a verified ingredient list gets +10, so it comes
  first among equals. Otherwise the most recently researched product comes first.
- **One character** (the start of typing) matches only the start of a name.
- **Categories:** the category words (`CATEGORY_SYNONYMS`) moved here from
  `search-barcode-service.ts`.
- **Speed:** each product's keys are computed once and kept in a `WeakMap`, and the category
  words once, so a keystroke doesn't normalise every name again.
- **No hard category filter:** a category word in the query used to drop every product of
  another category, including research results with the category `other`. Now the words must
  match instead.

The chat's product search uses the same matcher, since both go through `searchCosmeticsLive`.
Two chat changes follow from it:
- **The check before paid web research** (`namesProduct`: is there already a verified product
  whose name contains the query?) uses the same keys. A question in hiragana about a saved product
  no longer pays for a web search.
- **Web research results come first.** Research runs only when no verified product names the
  query, so its results fit better than the saved ones. They used to be added last and could be
  cut off by the limit after a brand's other products.

### The route

- It loads the saved products from KV first (`hydrateVerifiedProducts`, at most every 5 minutes per
  isolate).
- The result cache key is `search:v3` and uses `searchKey`, so 「きゅれる」, 「キュレル」 and 「ｷｭﾚﾙ」 share
  one cached result. A query of only symbols gets its own key, apart from the empty query
  (popular products).
- **Open Beauty Facts:** it is asked only when the saved products give fewer results than the
  limit, and not for one character. Its timeout is now 4 s (it was 2.5 s; `nivea` took 2.3 s in
  the evaluation and 3.0 s here), and it now also covers reading the reply body.

### The tray

An empty result now replaces the old candidates instead of leaving them on screen.

## Checks

- Test 80:
  - `searchKey`: hiragana, half-width kana (with dakuten), ゔ, accents, full-width letters,
    brackets, the minus sign and middle dot, dakuten kept, the long vowel kept;
  - ranking: brand prefix, verified first, every word must match, the brand fallback only when
    nothing else matches, category words, kana not matching kanji, a name in a chat sentence, a
    two-letter Latin brand, barcodes, one character;
  - the fixtures use their own brand names, so products other tests put in the shared cache
    don't change the result;
  - `searchCosmeticsLive` finds saved products by hiragana, and asks Open Beauty Facts only when
    short of results.
- `wrangler dev` with the local KV (products saved by earlier chat research):

  | Query | Time | Top result |
  |---|---|---|
  | きゅれる | 0.15 s | Curel キュレル 潤浸保湿 泡洗顔料 |
  | キュレル, ｷｭﾚﾙ, curel | cached | the same |
  | ちふれ | 0.01 s | ちふれ 美白化粧水 VC&AR |
  | ニベア クリーム | 4.0 s | ニベアクリーム 中缶 (Open Beauty Facts) |
  | nivea | 3.0 s | none |

## Code review

`code-improver` found one High and four Medium issues:
- **High, fixed:** paid web research results were added after every saved match and could be cut
  off by the limit. They now come first. This was there before; the brand fallback made it more
  likely.
- **Medium, fixed:**
  - the check that skips paid research used the old normaliser, so a hiragana question about a
    saved product still paid for a search;
  - a chat sentence never matched a name, only the brand. Added the name-in-sentence rule, and
    a 3-character minimum for Latin-only brands;
  - the category words and product keys were normalised again on every request. They are now
    kept.
- **Low, fixed:** the minus sign and middle dot are ignored; a query of only symbols no longer
  shares the cache with the empty query; the Open Beauty Facts timeout covers the body; test 80
  uses its own brands and more cases.

Declined:
- **Ranking and filtering Open Beauty Facts results with the same matcher:** they often have only
  an English or brand name (「Curel」 for 「キュレル」), so filtering them would drop real
  products. Open Beauty Facts has already searched for the query.
- **A shorter cache for results below the limit, so an Open Beauty Facts failure isn't cached for
  an hour:** it would ask Open Beauty Facts again much more often for queries that have few
  results anyway.
- **No test for web results coming first:** that path needs a mocked web search and Gemini page
  read. The change is one line, `unshift` instead of `push`.

## Not done

- **More products on file.** Type-ahead finds only products someone has already researched, up
  to 300 in KV. Ways to grow it:
  - raise the limit, or keep a separate name index;
  - add the shopping APIs once the keys arrive, behind their rate limits, perhaps only after a
    pause in typing.
- **Kanji from kana.** Finding 「潤浸」 from 「じゅんしん」 needs readings for product names, which the
  sources don't give.
- **Open Beauty Facts latency.** A query with no saved match waits up to 4 s. The tray could show
  the saved matches first and add Open Beauty Facts results after.
