# Fixes from the live UI review (2026-10-23)

Written 2026-10-23. Status: implemented 2026-10-23 (not committed). Test 123.

Follows the live review of `cc613f2` (Cloudflare version `7a1a3c2c`). Four problems were found; three
are fixed here, one is kept as the owner decided.

## Problems

1. **Picking a shop card can dead-end.** セタフィル's first tray card has a JAN code, so the browser runs
   `barcode_lookup`. The barcode isn't known, and the reply 「バーコード（3499320012676）の製品は見つかりません
   でした」 offers 「商品名で検索する」 with an empty input. A shop card without a JAN code goes through
   `lookup_product`, which searches by the shop's name for the item; a card with one never gets that search.
2. **The same product appears more than once.** 「キュレル 潤浸保湿 乳液」 in chat returned kao-kirei.com's
   and cosme.net's pages for JAN 4901301236173 as two cards. The brand line read 「Curel」, 「キュレル /
   curel」 and 「花王 / キュレル」 for one brand.
3. **Shop cards show no product name.** Kept: the owner asked for photo and price only, and cleaning
   Rakuten's names would alter their data (terms Art. 10 (7); `docs/walkthroughs/2026-10-15-shop-lineups.md`).
   Showing a size taken from the name is the same kind of alteration.
4. **On a phone, the green 「肌を整える・うるおいを保つ成分」 box is longer than a screen** (5 full sentences
   for キュレル 乳液) and pushes the ingredient list down.

## Changes

### Step 1: one lookup for shop cards, barcode first, then name (problem 1)

- **Browser** (`ChatContainer.tsx`, `handleSelectProductToAnalyze`): every `shop_` product goes to
  `lookupShopProduct` (`lookup_product`), with or without a barcode. The reply may now carry
  `singleAnalysis` as well as `productSuggestions`, so `pickReply` takes both.
- **Server** (`api/chat/route.ts`, `lookup_product`):
  1. If the product has a barcode that passes `BARCODE_PATTERN`, run `lookupByBarcode` first. Found →
     the same reply as a scanned barcode (`summarizeProductAnalysis`, `singleAnalysis`,
     `singleAnalysisReplies`). This runs before the lineup check, as a typed barcode does: a barcode
     isn't personal text and the lookup is the existing one.
  2. Not found → the existing path: re-check the item with the shops, then search by the server's own
     copy of the name (`shopProductQuery`).
  3. Nothing found by either → the existing reply, without 「バーコードをスキャンする」 when the barcode was
     already tried.
- **Cost:** a card whose barcode isn't known can now run a barcode lookup and a name search. Both are
  inside the spend cap, and the barcode miss is cached (`barcode:v2:…:miss`), so a second pick of the
  same card only pays for the name search.
- The scanned-barcode reply (`barcode_lookup`) is unchanged: there the app has no name to search by.

### Step 2: one card per JAN code, one spelling per brand (problem 2)

- **Duplicates:** a helper `onePerBarcode(products, isVerified)` in `src/lib/search/product-match.ts`
  keeps one product per barcode (digits only, leading zeros ignored, as `lookupByBarcode` compares).
  The kept one is the first with a verified ingredient list, else the first; it takes the earlier
  position. Products without a barcode, or with different barcodes, are never merged: different JAN
  codes can be a refill or a renewed formula, and names alone are too loose to compare. Used in:
  - `searchCosmeticsLive`, before the strict filter (step D) — chat search, research and the tray;
  - the typeahead's `withBrandFirst` (`api/products/search/route.ts`), which merges the brand's saved
    products with the search results by id only.
- **Brand spelling** (`brand-suggest.ts`, `display-brand.ts`): `getDisplayBrand` shows the name from
  `BRANDS_JP` when every part of the brand field is exactly one of its names, readings or aliases
  (parts split at 「/」「,」「、」; compared with `searchKey`).
  - Exact parts, not the typeahead's word matching: that would show 「Kate Somerville」 as ケイト and
    「DEW STORY」 as デュウ.
  - When the parts name a maker and one of its brands (「花王 / キュレル」), the brand wins. Mark the
    makers in `BRANDS_JP` with `maker: true`: 資生堂, 花王, カネボウ, コーセー, ポーラ, ロート製薬.
  - When a part matches nothing, or the parts name two brands that aren't makers, show the field as now.
  - Display only: the stored `brand` is unchanged, so search, the Amazon link and saved routines don't
    change.
- `display-brand.ts` is used in the browser; `brand-suggest.ts` imports only the brand list,
  `product-match.ts` and types, so it can be imported there. The list adds about 6 KB.

### Step 3: shorter green box (problem 4)

`IngredientAnalysisCard.tsx`: show the first 2 items. When there are more, the rest go in a
`<details>` under them, summary 「ほか{n}成分の説明」 (at least 44 px tall, like the AI list's
summary). The heading and the order don't change, and nothing is hidden from screen readers that a tap
can't open.

### Step 4: tests and checks

- Test 123:
  - `lookup_product` with a barcode that's saved → `singleAnalysis`, no shop call; with an unknown
    barcode → falls through to the name search (the test-83 fixtures).
  - `searchCosmeticsLive` with two saved products of one JAN → one result, the verified one; with two
    JAN codes → two.
  - `getDisplayBrand`: 「Curel」, 「キュレル / curel」, 「花王 / キュレル」 → 「キュレル」; 「花王」 → 「花王」; an
    unlisted brand unchanged.
  - Source check: the green box's `<details>` and the 2-item limit.
- Gallery screen `analysis` at 375 px, `pnpm check:responsive -- --only=analysis`, and the
  code-improver review.

## Not changing

- **Shop card names** (problem 3), as above.
- **The 「商品名で検索する」 prompt after a scanned barcode:** no name is known to prefill.

## Review (2026-10-23, before implementing)

- **Brand matching too loose:** the first draft reused the typeahead's word matching, which would turn
  「Kate Somerville」 into ケイト. Changed to exact parts (step 2).
- **A second merge path:** the typeahead puts the brand's saved products before the search results and
  merges them by id only, so one JAN could still show twice in the tray. The helper is used there too.
- **Privacy:** step 1 sends nothing new out. The barcode lookup is the one a typed barcode runs, and
  the name search still uses the server's copy of the shop's name, after the lineup check.
- **Gallery:** the `analysis` fixture has fewer than 3 green items; `analysis-long` shows the
  `<details>`.

## Implementation notes

- **Responsive checker** (`scripts/check-responsive.mjs`): Chrome hides a closed `<details>` with
  `content-visibility`, not `display: none`, so the checker measured the folded items and reported
  overlaps. `hiddenFromView` now skips the contents of a closed `<details>` other than its `<summary>`.
  After that: 0 breaks on the analysis and tray screens. The suggestions screens flag only the
  「Supported by Rakuten Developers」 link (vendor snippet, unchanged).
- **The green box's summary** uses padding (`py-3`, 44 px), not `flex`: `display: flex` on a
  `<summary>` hides its disclosure triangle.
- **Test 83:** the forged-product case now sends no barcode, because the barcode is looked up first.
  Test 123 covers a forged product with an unknown barcode and checks its name is never sent out.

## Code review (after implementing)

- **Fixed (Medium):** a barcode that Open Beauty Facts knows without an ingredient list returns a
  placeholder list. Step 1 returned it as the analysis and skipped the name search. Such a result now
  falls through to the name search (`hasNoIngredients`); test 123 covers it.
- **Fixed (Low):** the typeahead skipped the outside search when the brand's saved products reached the
  limit, counted before merging by JAN code. It now counts after `onePerBarcode`.
- **Declined (Low):** the barcode of an unknown `shop_` product comes from the browser, so a crafted
  request can get the analysis of another product. It only misleads the sender and costs the same as a
  typed barcode; tying it to the lineup would put a shop call before every barcode lookup.
- **Declined (Low):** the brand list (~150 entries) now ships to the browser with the cards. It is a
  few KB and was judged acceptable.
