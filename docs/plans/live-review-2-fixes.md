# Fixes from the second live UI review (2026-10-23)

Written 2026-10-23. Status: implemented 2026-10-23 (not committed). Test 124.

Follows the live review of `95d0053` (Cloudflare version `7a13963c`), which checked the fixes in
`docs/plans/live-review-fixes.md`. Those worked; the review found five new problems. Four are fixed
here, one is left as it is.

## Problems

1. **A shop card's name search can end in a card that can't be analysed.** The セタフィル card's
   barcode wasn't known, so `lookup_product` searched by name (with paid Web research, about 40 s). It
   returned one product, 「セタフィル モイスチャライジングローション 591ml x 2個」, without an ingredient
   list. Tapping it gave 「成分データ不足で判定できません」: two taps and a wait to learn nothing.
   `research_product` already drops such products (`hasVerifiedIngredients`, or a shop listing with
   ingredients); `lookup_product` doesn't.
2. **The "no data" reply contradicts itself and repeats itself.** The chat bubble opens with
   「…の成分を確認しました」 although there is no list (`summarizeProductAnalysis`). The sentence
   「全成分データが取得できていないため…」 is in the bubble and again in the card. The card shows an empty
   「全成分リスト (0成分)」 heading with 「タップで成分解説を表示」 and nothing to tap.
3. **The user's own message names the brand twice:** 「セタフィル セタフィル モイスチャライジング…」.
   `handleSelectProductToAnalyze` builds `「${product.brand} ${product.name}」`. The server's reply
   text already avoids this with `productLabel` in `chat-replies.ts`, which the browser can't import.
4. **The two キュレル 乳液 cards look alike.** Left as it is; see "Not changing".
5. **The tray shows a ふるさと納税 listing** (¥10,000) among the キュレル shop cards. A donation return
   gift isn't the shop item a user is looking for, and its price isn't a shop price.

## Changes

### Step 1: no ingredient-less candidates from a shop card's lookup (problem 1)

`api/chat/route.ts`, `lookup_product`: keep only products with an ingredient list, with the filter
`research_product` uses. Move that filter into one helper next to `hasNoIngredients`
(`hasUsableIngredients(p)`: `hasVerifiedIngredients(p) || (isShopListingProduct(p) && p.ingredients.length > 0)`)
and use it in both actions.

- Nothing left → the existing "not found" reply (step 1 of the previous plan: no 「バーコードを
  スキャンする」 when the barcode was tried). The user learns it in one step and gets
  「成分表示を入力する」 right away.
- No 「Webで成分を調べ直す」 here: this action has just run the Web research.

### Step 2: honest wording for a product without ingredients (problem 2)

- `chat-replies.ts`, `summarizeProductAnalysis`: when `overallRiskLevel === 'insufficient_data'`, the
  bubble says 「「{name}」の全成分は見つかりませんでした。」 (with a barcode: 「バーコード（…）の製品は
  「{name}」です。全成分は見つかりませんでした。」), followed by one line about what to do next:
  「パッケージの全成分表示を入力すると、成分を調べられます。」 It no longer repeats `summaryJa`, which
  the card shows. The buttons under it (`NO_INGREDIENTS_REPLIES`, with 「Webで成分を調べ直す」) don't
  change.
- `IngredientAnalysisCard.tsx`: when `ingredients.length === 0`, don't render the 「全成分リスト」
  section (heading, hint, legend, pills). The card's summary already explains why.
- Check the new texts with `hasProhibitedClaim`.

### Step 3: the brand once in the user's message (problem 3)

Move `productLabel` from `chat-replies.ts` into `src/lib/display-brand.ts` (client-safe, already
imported by the cards) as an export, and use it in both places:
- `chat-replies.ts` imports it instead of its own copy;
- `ChatContainer.tsx`, `handleSelectProductToAnalyze`: `「${productLabel(product)}」の成分を詳しく知りたい`.

The shop-card path (`lookupShopProduct`) already uses the name alone, since shop names contain the
brand.

### Step 4: no ふるさと納税 listings (problem 5)

`price-service.ts`, `NOT_SINGLE_ITEM`: add `ふるさと納税|返礼品`. That pattern is already used to drop set
and bulk listings from the shop lineup and the price search, so both stop showing them. The listing
names aren't changed, only skipped.

### Step 5: tests and checks

- Test 124:
  - `lookup_product` whose name search finds only a product without ingredients → no
    `productSuggestions`, the "not found" reply.
  - `summarizeProductAnalysis` of an `insufficient_data` analysis → contains 「全成分は見つかりません
    でした」, not 「成分を確認しました」 nor `summaryJa`; the texts pass `hasProhibitedClaim`.
  - `productLabel`: brand already in the name → the name alone; otherwise brand and name.
  - `NOT_SINGLE_ITEM` matches a 【ふるさと納税】 name and not a plain one; `brandLineup` drops it (test-83
    style fake shop response).
  - Source checks: the card skips the list when there are no ingredients; `ChatContainer` uses
    `productLabel`.
- Gallery: add a screen `analysis-no-data` (a product without ingredients) to check the card, then
  `pnpm check:responsive -- --only=analysis` and the code-improver review.

## Not changing

- **The two キュレル 乳液 cards** (problem 4). They have different JAN codes (4901301236173 and
  4901301413277), most likely a reformulation, and different sources. The app can't tell which one
  the user has; the JAN code on each card is how to match the package. Merging by name would hide a
  real difference.
- **Re-research after a shop card's lookup.** The lookup has just run the Web research; offering it
  again right away would usually repeat the same result and cost.

## Review (2026-10-23, before implementing)

- **Step 2's next-step line:** the first draft said 「下のボタンから Web で調べ直す」. The same reply is
  used for a typed ingredient label (`analyze_label`), where no Web button is shown, and the Web button
  can be used only once per message. Changed to a line that is true everywhere; the buttons say the rest.
- **Step 1 and test 83:** test 83's saved product (`t83_lotion`) has a verified list, so it still
  appears. The filter is the one `research_product` already uses (`route.ts` line 240), so the two
  actions agree on what counts as a usable candidate.
- **Step 3 imports:** `display-brand.ts` is client-safe and `chat-replies.ts` (server) can import it;
  no cycle (`display-brand` → `brand-suggest` → data and `product-match`).
- **Step 4 scope:** `NOT_SINGLE_ITEM` is shared by the lineup and the price search. Dropping ふるさと納税
  from the price search is also right: the amount is a donation, not a shop price.

## Code review (after implementing)

- **Fixed (High):** `insufficient_data` also covers a list where most ingredients aren't rated. The
  first version said 「全成分は見つかりませんでした」 for those too, even for a label the user had just
  typed. The new wording is now only for an empty list (`ingredients.length === 0`, the same test the
  card uses); a list with too few rated ingredients keeps its previous reply. Test 124 covers both.
- **Declined (Low):** the next-step line could reach someone who typed the label. A typed label with
  no ingredients is rejected before analysis (`productFromLabel`), so this can't happen.
- **Declined (Low):** test 124 reads source files by relative path and removes its product from
  `COSMETICS_DATABASE` in `finally`, as the other tests do.

## Follow-up: the marketplace notice (2026-10-23, owner decision)

A product marked as estimated from marketplaces but without an ingredient list (a barcode Open Beauty
Facts knows without ingredients) showed 「本製品の全成分情報は…収集したもの」 on a card with no list. The
owner chose to hide it: `analyzeProduct` sets `dataSourceDisclaimer` only when there are analysed
ingredients. `isEstimatedFromMarketplaces` is unchanged. Test 6 now checks both cases (no list → no
notice; a list → the notice).
