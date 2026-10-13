# Walkthrough: prices from listed shops, ready for affiliate links (2026-10-13)

What was built for [the shop prices plan](../plans/shop-prices.md), and how it was checked.

## What changed for the user

- **Which shops:** the price card shows offers only from 楽天市場 (with 楽天24), Yahoo!ショッピング
  and @cosme SHOPPING.
  - Brand sites, LIPS, review sites and other shops are no longer used.
  - The card shows at most 2 offers per shop and 6 in all.
- **Each offer** shows the price, tax, the product name as the shop writes it, the shop and its
  store, and a 「<shop>で見る」 button.
- **Amazon** stays a search link with the Associates tag. Amazon prices may only come from Amazon's
  own API.
- **When affiliate IDs are set:**
  - the buttons become affiliate links with `rel="sponsored"`;
  - the card shows 「PR」 and a one-line note.
- **Credits:** when a price came from the Rakuten or Yahoo! API, the card shows that company's
  credit, verbatim.

## How it works

| Part | Where | Notes |
|---|---|---|
| Shop list | `SHOPS`, `shopOfUrl` in `src/lib/services/shops.ts` | Product-page URL patterns, https only. Listings, shop tops and look-alike hosts are rejected |
| Affiliate links | `shopLink` | Rakuten: `hb.afl.rakuten.co.jp/hgc/<id>/` with the page as `pc` and `m`. Yahoo! and @cosme: an ASP link template with one `{url}`. Without a valid ID or template, the plain page |
| APIs | `rakutenOffers`, `yahooOffers` in `src/lib/services/shop-apis.ts` | Only when the keys are set. Rakuten: all of Rakuten, then 楽天24 1.1 s later. The access key goes in a header. A 429 is retried once. Logs show only a label and a status |
| Pages | `pageOffers` in `price-service.ts` | For a shop without API keys, and always for @cosme SHOPPING: web search for 「<product> <shop name>」, keep only that shop's product pages (the new `accept` filter on `webSearch`), and read at most 2 of them, one Gemini call per page as before |
| Checks | `researchPrices` | The URL must be the shop's product page, the price 100 to 100,000 yen in whole yen, every query word in the name, and no set, bundle, used item or sample. Long API names are cut for display after the check |
| Card | `PriceResultCard.tsx` | 「PR」, the note, `sponsored` rel, credits. Older chat messages without `href` fall back to `sourceUrl` |

## Tests

- **65 (updated):** pages outside the listed shops are never read, even when the search returns
  them. There is one search per shop, and links are plain without IDs.
- **66 (updated):** the chat route searches with 「<product> <shop name>」 only.
- **67 (new):**
  - URL patterns: https only, listing and top pages rejected, the old PayPayモール form accepted;
  - prices from both APIs with no Gemini, and the 楽天24 call;
  - the access key is sent in a header and kept out of the URL;
  - sets and bundles (×3, 3個セット) and used items are dropped;
  - at most 2 offers per shop, and the credits;
  - affiliate links for all three shops, and malformed IDs or templates ignored;
  - a 429 retried once;
  - an empty query matching nothing;
  - failures reported as 「時間をおいて」, with no key in the logs.

## Live test (wrangler dev, dev gateway, no shop API keys yet)

| Request | Time | Result |
|---|---|---|
| 「キュレル 潤浸保湿 化粧水の最安値を教えて」 | 15.0 s | 4 offers: @cosme SHOPPING ¥1,650 (two 130 mL refills, I and III) and Yahoo! (爽快ドラッグ ¥1,816; アットコスメショッピング Yahoo!店 ¥2,090). Nothing from Rakuten |
| 「ちふれ 美白化粧水 W はいくら？」 | 7.5 s | No offer. The Yahoo! and @cosme pages found were a different product (美白化粧水 VC&AR) and were correctly rejected |
| 「ミノン アミノモイスト モイストチャージ ローションの最安値」 | 19.1 s | 2 offers from @cosme SHOPPING (refill ¥1,760, bottle ¥2,200) |

**Finding:** without the API, Rakuten is almost never found. The web search returned no
`item.rakuten.co.jp` product page for any of the three products; Linkup returned only
`search.rakuten.co.jp` listings, which are skipped. **The Rakuten API keys are needed for Rakuten
prices.** Yahoo! product pages do turn up in the search, but the API will find more.

The page path is slower than before (7–19 s against 6–9 s): three searches instead of one, and up
to six page reads. With both API keys set, only @cosme SHOPPING is read from pages.

## Code review

`code-improver` found no Critical or High issues. It confirmed that only the product query reaches
search and the APIs, that nothing is cached, that keys reach no log, that links are http(s) only
and that the templates can't be abused.

**Fixed:**
- **Medium:** the second Rakuten call came straight after the first, against a limit of about 1
  call per second, and a 429 was not retried. The calls are now 1.1 s apart, with one retry.
- **Medium:** `24.rakuten.co.jp` and `www.rakuten.ne.jp/gold/` matched any path, including
  listings and shop tops. Rakuten 24 is now matched through `item.rakuten.co.jp/rakuten24/`, and
  gold pages need a page below the shop.
- **Medium (to check against a live response):** Yahoo! URLs could be in the old PayPayモール
  form. Both forms are accepted.
- **Low:**
  - an empty query matched every product;
  - the set filter missed 「×3」 and 「まとめ売り」 and ran only on API results (now on both);
  - `http:` product URLs were accepted.

**Kept as is:**
- **Yahoo! `priceLabel.taxable`:** the v3 reference describes it as 「税込み価格かどうか」, which
  is how it is used.
- **The Rakuten credit link** has no `rel`. The terms require the snippet verbatim, and browsers
  imply `noopener` for `target="_blank"`.

**Not done:** a limiter shared across users for the API rate limits. Under load, a source can still
come back as unavailable for one request.

## To do when the IDs and keys arrive

1. **Rakuten Web Service app (free):**
   `pnpm exec wrangler secret put RAKUTEN_APPLICATION_ID` and `RAKUTEN_ACCESS_KEY`, plus the same in
   `.dev.vars`.
2. **Yahoo! Developer Network app (free):** `YAHOO_CLIENT_ID`, set the same way.
3. **Affiliate IDs:** set `RAKUTEN_AFFILIATE_ID`, `YAHOO_AFFILIATE_LINK_TEMPLATE` (ValueCommerce
   MyLink) and `COSME_AFFILIATE_LINK_TEMPLATE` under `[vars]` in `wrangler.toml`.
4. **Check one live response from each API:**
   - the URL form (Yahoo!);
   - `taxable`;
   - that an affiliate link opens the right product and is counted in the ASP's report.
5. **Amazon:** when the Associates account qualifies, add Amazon prices through the Creators API,
   and add the Associates statement to the site.
