# Brand lineups from Rakuten and Yahoo! item search (2026-10-15)

Follows [brand-first type-ahead](2026-10-15-brand-typeahead.md). The owner asked to build the
Rakuten and Yahoo! item search from their documentation before the affiliate IDs arrive. The
search needs only the API keys (`RAKUTEN_APPLICATION_ID` + `RAKUTEN_ACCESS_KEY`, `YAHOO_CLIENT_ID`);
the affiliate IDs only change links, and this feature shows no shop links.

## Sources

- [Rakuten Ichiba Item Search API, version 2026-07-01](https://webservice.rakuten.co.jp/documentation/ichiba-item-search):
  endpoint `openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701`, `applicationId` in the
  query, `accessKey` in a header (or the query; the app uses the header so it stays out of URLs),
  `hits` up to 30, `formatVersion=2`, `elements` to choose output fields, `availability`.
  Errors 400/404/429/503.
- [Yahoo!ショッピング 商品検索 v3](https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html):
  `appid`, `query`, `results`, `in_stock`, `condition`, `sort`; each hit has `name`, `code`, `url`,
  `brand` and `parentBrands` (`id`, `name`), `janCode`. 利用制限: about 1 query per second.
- [Yahoo! affiliate](https://developer.yahoo.co.jp/webapi/shopping/affiliate.html): ValueCommerce's
  `affiliate_type=vc` and `affiliate_id` turn the item URLs into affiliate URLs. Not used yet.
- [Rakuten Web Service terms](https://webservice.rakuten.co.jp/guide/rule), Article 10 (Forbidden
  Actions):
  - (7) using or **altering** information obtained through the service other than as the company
    allows;
  - (9) **storing** it "in a place that enables the sharing of information with unspecified and/or
    many people".

  Article 3: links to Rakuten product pages for remuneration go through Rakuten Affiliate.
- Credits: the official Rakuten and Yahoo! snippets, as already used on the price card.

## Design

- **When:** the search API already reports the brand a query starts with (`brand: { name, rest }`).
  The browser then calls `GET /api/products/lineup?brand=<name>` **once per brand per page view**.
- **What is sent to the shops:** only the brand's name from the list (or from a saved product).
  The endpoint returns 400 for any other text, so nothing the user typed reaches Rakuten or Yahoo!.
  The rest of the query (「化粧水」) is matched in the browser.
- **No server storage:** the lineup is not put in KV, in memory, or in the shared product cache.
  The browser keeps it in React state for that page only, which is not a place shared with many
  people. The response says `Cache-Control: private, max-age=600`: the browser's own cache may keep
  it, shared caches may not.
- **Failures:** if a shop call fails or is skipped by the per-minute count and nothing came back,
  the endpoint answers 503. The browser tries that brand again only after 30 s, instead of on every
  keystroke or never.
- **Cards show a photo and a price, not the name** (owner's request): shop names carry 「【公式】…送料無料」
  and similar, and cleaning them would alter Rakuten's data (Article 10 (7)). So the card shows the
  item's photo, the brand from our list and the price, and no shop name. The name is kept unchanged
  and used only as the photo's tooltip and the button's screen-reader label, and
  internally for narrowing by the rest of the query, the cosmetics check and search terms.
  - Photo: Rakuten `mediumImageUrls[0]` (128×128; `elements` now asks for it), Yahoo! `image.medium`
    (146×146). Only `https` URLs on the shops' image hosts (`*.rakuten.co.jp`, `*.yimg.jp`), with no
    user name, password or port, are used, so a listing can't make browsers load another site. Shown with a plain `<img>`
    (`loading="lazy"`, `referrerPolicy="no-referrer"`), not through `next/image`, so the image isn't
    copied or resized by us. No photo, or one that fails to load: a package icon. The photo's
    `alt` is empty, so a broken image never shows the listing name, and screen readers hear the name
    once, on the button.
  - Price: Rakuten `itemPrice` with `taxFlag`, Yahoo! `price` with `priceLabel.taxable`, shown as
    returned, with 「（税別）」 when the shop says it excludes tax. It is one listing's price, kept only
    in the page like the rest of the lineup.
- **Shop links (added 2026-10-17, when the Rakuten affiliate ID arrived):** each card has a small
  「商品ページ」 link, built by the price feature's `shopLink`, with no shop name. No `sourceUrl`.
  - Rakuten: only as a Rakuten Affiliate link (`hb.afl.rakuten.co.jp/hgc/<RAKUTEN_AFFILIATE_ID>/`).
    Without a valid ID there is no Rakuten link at all. Article 3 and Article 10 (4)(5) allow income
    from the API only through Rakuten Affiliate, so another network (e.g. もしもアフィリエイト) is
    not used for these products.
  - Yahoo!: through `YAHOO_AFFILIATE_LINK_TEMPLATE` (ValueCommerce MyLink, set 2026-10-17), else the
    plain item page.
  - An affiliate link shows 「PR」, and the tray adds the one-line note used on the price card
    (景品表示法, stealth-marketing rule).
  - `rel="sponsored nofollow noopener noreferrer"` on affiliate links. The tray renders only `https`
    links, and never a non-affiliate Rakuten link, even if the server sent one.
  - Screen readers hear 「PR 商品ページ」 first, then the product name and that it opens a new tab;
    the link is 32 px high so it isn't mis-tapped next to the main button.
- **Which items are kept** (`brandLineup`):
  - of the brand: Yahoo!'s `brand` or `parentBrands` name matches the brand, or the item name
    contains it (Rakuten has no brand field);
  - not a set or bundle (the price feature's `NOT_SINGLE_ITEM`), in stock, new;
  - a cosmetic (`isActualCosmeticProduct` on the name without listing words like 公式 and 送料無料,
    which that check treats as non-product queries);
  - one per JAN code and per name. Yahoo! comes first, because its items have JAN codes;
  - up to 40.
- **Credits:** the tray shows 「Supported by Rakuten Developers」 and 「Webサービス by Yahoo! JAPAN」
  for whichever shop's items are on screen.
- **Rate limits:** each API allows about one call per second per app ID. All shop calls (lineups
  and prices) now go through the spend-cap Durable Object as zero-cost buckets `rakuten_api` and
  `yahoo_api`, 50 per minute across all users (`SPEND_PER_MINUTE_RAKUTEN_API`,
  `SPEND_PER_MINUTE_YAHOO_API`). Over that, the call is skipped. Zero-cost calls are counted only
  per minute: they don't depend on the dollar budget, and they don't write to the Durable
  Object's storage. Per minute is looser than per
  second, so a 429 can still happen in a burst; the existing single retry after 1.1 s handles it.

## Picking a shop product

These products have no ingredient list, so the card shows 「成分は選ぶと調べます」 under the price and hides the
「肌荒れした」「普段使えている」「今使っている」 buttons (an empty product would break comparisons). Tapping
「成分を詳しくチェック」:
- **with a JAN code** (Yahoo!): the existing barcode lookup (saved products, Open Beauty Facts, then
  web research by the code);
- **without one** (Rakuten): the new chat action `lookup_product`.
  - **The server does not trust the product the browser sends.** It finds the brand in the list,
    asks the shops for that brand again (free, counted per minute), and accepts the product only if
    the shops still return one with that id. It then uses **its own copy** of the name. Any other
    text gets a fixed reply and reaches no search.
  - It builds a search term from the brand and the name without listing words, and runs the normal
    product search: saved products and Open Beauty Facts first, paid web research only when no saved
    product names it, within the spend budget. The user picks from the products found.
- One lookup at a time: a second tap while one runs is ignored, and an error is shown in the chat.

## Checks

- Test 83 (documented response shapes, fetch mocked):
  - no keys, no calls;
  - the Rakuten request: path, `applicationId`, `keyword` = brand only, `formatVersion`, the access
    key in a header and not in the URL; the Yahoo! request: path, `appid`, `query`;
  - kept and dropped items (other brand, set, out of stock, duplicate JAN code), Yahoo! first,
    names unchanged, no `sourceUrl`, credits; photo and price from both shops (Rakuten's
    formatVersion 1 and 2 photo shapes, 税込 and 税別), photo URLs dropped for `http`, a lookalike
    host and a user name and port, a price that isn't a whole number dropped, `mediumImageUrls` in
    `elements`, no shop label; links: plain Yahoo!, no Rakuten link without an ID, both affiliate
  links with IDs;
  - the per-minute count stops a second Yahoo! call when set to 1;
  - the endpoint: 400 for text that is not a brand, no KV write, nothing in the shared cache;
  - `lookup_product` finds a saved product from a Rakuten name with 【公式】 and 送料無料;
  - a forged product (an id and name the shops didn't return) is refused, and only the shops are
    asked;
  - both shops failing gives 503;
  - test 79: a zero-cost call is allowed after the budget is used up.
- `wrangler dev` without shop keys: the search reports `brand: { name: 'キュレル', rest: '化粧水' }`,
  the lineup endpoint answers 200 with no products, and 400 for a non-brand.
- **Not checked against the live APIs**: the keys are not set yet. When they are, check one brand
  on `wrangler dev` with the keys in `.dev.vars`.

## Code review

`code-improver` found one High issue, fixed:
- **`lookup_product` trusted the product sent by the browser.** Any text with an id starting with
  `shop_` went to the paid web search without the chat gate. The server now re-checks the product
  against the shops and uses its own copy of the name.

Medium, fixed:
- **A failed lineup was remembered as empty** for the page, and a failed request was retried on every
  keystroke. Now 503, and the browser waits 30 s.
- **Zero-cost calls depended on the dollar budget,** so after a Gemini call ran over it, shop prices and
  lineups stopped too. Each one also wrote the totals to storage. Both fixed.
- **Double taps** started two lookups, and errors showed nothing. Now one at a time, with an error
  message.
- **Browser cache:** `Cache-Control: private` so the same browser doesn't ask again for 10 minutes.

Low, fixed: an old search reply could start a lineup request for a brand no longer typed; each
card's button names its product for screen readers; the result count is announced; test 83 checks
that no KV write happens at all and removes its saved product.

Declined:
- **Spacing shop calls one second apart in the Durable Object, and a separate count for lineups so
  they can't use up the count prices need:** a design change for traffic the app doesn't have yet.
  The per-minute count, the single retry after a 429, and one request per brand per browser keep the
  load low. Revisit with real traffic.
- **The cleaned Rakuten name sent to the web search:** this is a search term, not stored and not
  shown. Article 10 (7) and (9) are about altering what is shown and storing it.

### Second round: photo and price on the cards

`code-improver` found no Critical or High issues. Fixed:
- **Medium:** a photo that failed to load showed its `alt` text, the listing name the card hides.
  It now falls back to the package icon, and `alt` is empty.
- **Low:** the name was read out up to three times per card (alt, title, button). Now once, on the
  button; the icon is `aria-hidden`.
- **Low:** test gaps (Yahoo!'s accepted photo, Rakuten's formatVersion 1 shape, 税別, a lookalike
  host); added.
- **Low:** photo URLs with a user name, password or port are dropped; the `shop_` id prefix is one
  constant, `SHOP_ID_PREFIX`, shared by the server and the tray.

Declined: pinning exact image hosts (e.g. only `thumbnail.image.rakuten.co.jp`). The hosts the APIs
really return haven't been seen yet; a wrong pin would silently drop every photo. Revisit with the
live check.

### Third round: shop links

`code-improver` found no Critical or High issues. Fixed:
- **Medium:** the link's `aria-label` replaced its visible text (WCAG 2.5.3), didn't say it opens a
  new tab, and the target was a 10 px line. Now the visible text leads, the rest is `sr-only`, and
  the link is 32 px high.
- **Medium:** test gaps. Test 83 now checks every Rakuten item has no link without an ID, a
  malformed Rakuten ID gives no link, a template without `{url}` gives the plain Yahoo! page, and
  links reach the endpoint's JSON.
- **Low:** the tray also refuses a non-affiliate Rakuten link, and the PR note no longer claims the
  order is unrelated to fees (Yahoo! items come first for their JAN codes, and Yahoo! links may be
  paid once its template is set).

Declined: a render test of the tray with `react-dom/server`. The suite has no component tests, and
the rules that matter (which links exist and whether they're sponsored) are checked on the data the
tray receives.

## Not done

- **Yahoo! `brand_id`:** searching by brand ID would be more precise than the name, but the IDs
  are not in our list.
- **LINE Yahoo! terms on storing data:** only Rakuten's storage rule was checked in detail. The
  same no-storage design is used for both.
