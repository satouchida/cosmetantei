# Walkthrough: alternatives and prices through web research (2026-10-13)

What was built for phases 3 and 4 of [the Gemini role redesign](../plans/gemini-role-redesign.md#phases-3-and-4-2026-10-13-done),
and how it was checked.

## What the user sees

- **Alternatives (T3):**
  - after a comparison, 「💡 おすすめの低刺激アイテムは？」 finds products without the culprits, in the
    same category as the bad products;
  - a message such as 「香料が入っていない化粧水のおすすめは？」 or 「パラベン不使用の乳液」;
  - after an ingredient answer, a button that names the ingredient:
    「🔍 フェノキシエタノールが入っていないコスメを探す」.
  - The products appear as the usual product cards (analyse, add to the lists). If none can be
    confirmed, the reply says so and asks the user to check the package label. No alternative is
    guessed.
- **Prices (T4):**
  - a message such as 「キュレル 潤浸保湿 化粧水の最安値を教えて」;
  - 「💴 この商品の価格を調べる」 after a single analysis (search, barcode or card).
  - A price card lists up to 5 confirmed offers, cheapest first. Each shows the price, whether tax
    is included, the product name as the shop writes it, the shop, and a 「出典」 link. It also shows
    the time checked and an Amazon search link. With no confirmed offer, only the Amazon link.

## How it works

| Part | Where | Notes |
|---|---|---|
| What to avoid | `alternativeRequest` in `src/lib/services/alternatives-service.ts` | DB ingredients named in the message (「無香料」「不使用」 count as "avoid" here, via `findIngredientsInText(…, { includeNegated: true })`). When the message negates some of them (「入っていない」「フリー」「不使用」「無〜」, also across a list like 「エタノールとパラベンが入っていない」), only those are avoided, so 「セラミド配合で香料フリー」 avoids fragrance only. Otherwise the culprits of a comparison recomputed on the server. The category comes from the message's words or the bad products |
| Search query | `buildAlternativeQuery` | Only fixed words and DB names: `敏感肌 化粧水 無香料 全成分`. Fragrance and fragrance allergens become 「無香料」, ethanol 「アルコールフリー」, parabens 「パラベンフリー」, others 「X不使用」 |
| Candidates | `researchAlternativeCandidates` in `web-research.ts` | Runs only when fewer than 3 cached verified products pass. Same page reader as T1 (source URL must be requested and read). Only products with a full ingredient list are kept, registered like T1 results, and cached as page facts under `altfacts:v1` for 7 days |
| Re-check | `findAlternatives` | `findSafeAlternatives` with the new `category` option: full verified ingredients, none of the avoided ingredients, no high or moderate irritant, never a user's label. Products listed under two brand spellings are merged (`productIdentityKey`) |
| Ingredient button | `alternativeButtonLabel`, `quickReplyIntent` in `chat-gate.ts` | Skips Clef only when the name is the first name of a DB entry. The fixed 「🔍 この成分が入っていないコスメを探す」 button is gone; it never said which ingredient |
| Price query | `toPriceSearchQuery` in `price-service.ts` | Removes price phrasing (最安値, いくら, どこで買える…) and then applies `toProductSearchQuery`, so sentences, personal details and numbers are still refused. The button uses `productSearchQuery(product)`: brand and name, without the volume |
| Price pages | `researchPrices` | `<name> 価格`. **One Gemini call per page**, in parallel, so text on one page can't attribute a price to another shop's page. The product name goes into the prompt as a JSON string marked as data. Pages read through `readPagesWithSources` with `skipCache` (sends `cf-aig-skip-cache: true`). Search-listing pages (`search.rakuten.co.jp`, `/search`, `/s/`) are skipped for every task |
| Price checks | `researchPrices` | Whole yen 100–100,000; the page's brand and product name contain every word of the query; at most 3 offers per page; the same shop, name and price once. Sorted with tax-excluded prices raised by 10%. The reply names the cheapest item, not just the shop. A failed search or read gives `status: 'unavailable'` and 「時間をおいてもう一度」, not "no price". 「このクリームの最安値」 is not searched |
| Button name | `productSearchQuery` in `web-research.ts` | First brand spelling only (「ちふれ化粧品 / ちふれ」 → 「ちふれ化粧品」). A name too long for `toProductSearchQuery` falls back to its first 4 words |
| Category | `isValidProduct` in `validation.ts` | A product's category must be one of the 8 fixed values (400 otherwise), because it reaches the alternatives query |
| Never cached | — | No KV write, no gateway cache, nothing stored in the browser beyond the chat message |
| UI | `PriceResultCard.tsx`, `ChatContainer.tsx` | Links open only for `http(s)` URLs, with `noopener noreferrer nofollow`. The price button sends `action: 'price_lookup'` with the analysed product |

Shared refactors: `readPagesWithSources` (generic source-checked page reading, used by T1 and T4),
`uniqueProducts`, `productSearchQuery`, and a `skipCache` option on `callGemini`.

## Tests

63–66 in `tests/test_suite.ts`:
- **63:** query building from messages, from a comparison, and with a personal sentence (the
  query keeps none of it); every DB ingredient button maps to its entry; an unknown name or a
  prototype key is not a button.
- **64:** of four page products, only the fragrance-free sunscreen with a full list passes; the user's
  text is not in the Gemini prompt; two brand spellings are merged; nothing confirmed means no
  alternatives.
- **65:** price phrasing removed, personal sentences refused; offers from an unread page, another
  product, or with 12 yen, 1.5 million yen, 1192.5 or a string are dropped; sorted cheapest first;
  `cf-aig-skip-cache` sent; a second lookup searches again; listing pages are skipped.
- **66:** the chat route sends price questions, the price button and alternative requests to their
  services with app-built queries, and asks for an ingredient or category when there is nothing to
  avoid.

## Code review

`code-improver` found no Critical or High issues. All findings were confirmed and fixed:
- **Medium:**
  - a crafted category such as `constructor` could put `Object.prototype` text into the search
    query; the category is now validated, and only the fixed list is used;
  - one Gemini call read all price pages, so a hostile page could attribute a price to another
    shop; now one call per page;
  - the cheapest price ignored tax display, and the reply didn't say which size;
  - the price button refused long names, and multi-spelling brands missed shop pages.
- **Low:**
  - pages with no usable product weren't cached as a miss, so paid lookups repeated;
  - the product name in the price prompt is now quoted as data;
  - a failed lookup now says "try again later" instead of "no price";
  - 「セラミド配合で香料フリー」 avoided ceramide too;
  - the empty price card's wording, `sponsored nofollow` on the Amazon link, a double-click guard on
    the price button, and a misplaced comment.
- **Changed from the suggestion:** the `/s/` path rule was removed, not kept, because some shops use
  `/s/` for product pages and it would also have hidden T1 pages.
- **Tests added for:** invalid categories (400), no KV writes for prices, one page per read, tax
  ordering, the unavailable status, long and multi-spelling names, and the negation rule.
- **Not added:** a deterministic local pool for test 66's alternatives branch (the branch asserts
  the query whenever fewer than 3 local products pass). No second review pass: each fix is small,
  has its own test, and was re-checked live.

## Live test (wrangler dev, dev gateway, 2026-10-13)

| Request | Time | Result |
|---|---|---|
| 「キュレル 潤浸保湿 化粧水の最安値を教えて」 | 14.0 s | 5 offers from ¥1,364. **Found a problem:** 3 came from a Rakuten search-results page, with shop text mixed into the product name. Listing pages are now skipped |
| 「ちふれ 美白化粧水 W はいくら？」 | 7.7 s | LIPS, ¥1,155 refill and ¥1,265 bottle, tax included |
| 💴 button on 無印良品 敏感肌用化粧水 高保湿 | 9.0 s | 4 offers from muji.com (50 mL ¥390 to 300 mL ¥990). The same offer on two Muji pages is now shown once |
| 「香料が入っていない化粧水のおすすめは？」 | 1.0 s | 3 cached verified toners, no web search. **Found a problem:** the same Chifure toner twice under two brand spellings; now merged |
| 「香料が入っていない日焼け止めを探して」 | 14.1 s | Web research: ミノン UVマイルドミルク and ノブ UVローションEX / UVミルクEX, each from the brand's own page, with full ingredient lists |
| 💡 after a comparison (香料, エタノール, リモネン, リナロール) | 0.0 s | 3 toners without them |
| 「フェノキシエタノールってどんな成分？」 then its button | 5.5 s, then 0.0 s | The button is offered; pressing it skips Clef and returns 3 products without phenoxyethanol |
| After the review: 「キュレル 潤浸保湿 化粧水の最安値を教えて」 | 6.1 s | 5 offers, all from product pages (@cosme, @cosme SHOPPING, Yahoo!), from ¥1,650 (130 mL refill, named in the reply). Per-page reads in parallel were faster than one combined read |
| After the review: 「セラミド配合で香料フリーの乳液を探して」 | 14.0 s | Only 香料 avoided; ノブ スキンクリーム D and アンブリオリス モイスチャークリーム センシティブ |

## Known limits

- **Variants:** a price search for 「キュレル 潤浸保湿 化粧水」 also returns I, II and III, refills and
  sizes. Each offer shows the shop's product name, so the user can tell them apart; the code doesn't
  pick one.
- **Brand spelling in prices:** an offer is kept only when the page uses the same words as the
  query, so a page that writes only 「Curel」 for 「キュレル」 is missed.
- **Source quality for alternatives:** T1 already accepts any page that shows a full ingredient
  list, including review sites (one cached toner came from cosmescope.com). Phase 7 will show the
  source on each card.
- **Product cards** don't say yet that an alternative came from web research (phase 7).
