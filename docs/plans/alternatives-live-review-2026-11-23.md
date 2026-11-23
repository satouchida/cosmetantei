# Plan: duplicates, wrong kinds, brand lines and a Yahoo! link (live check of 2026-11-23)

Written 2026-11-23. Status: steps 1–6 deployed as `fbf39df` (tests 207–211); a follow-up after review and live check is implemented but not deployed (test 212).
Follows the live check of `1de92c0` (Cloudflare version `438d85d7`): five request searches, with the
`[alternatives]` log line. Earlier rounds: [shop-search-reach.md](shop-search-reach.md),
[shop-names-and-cleansing-genre.md](shop-names-and-cleansing-genre.md).

These rules still hold:

- Code decides what is shown.
- The shops get only fixed words.
- There are no new paid calls.
- A shop link is shown only for a listing we checked.

## Step 1. One product saved under the brand and under its maker shows once

**Problem.** 「パラベンフリーの乳液」 showed ミノン アミノモイスト モイストチャージ ミルク twice:

- 「ミノン」「アミノモイスト モイストチャージ ミルク / 本体 / 100g / 無香料」
- 「第一三共ヘルスケア」「モイストチャージ ミルク」

`isSameProduct` (`product-identity.ts`) gives up when the brands differ, and these brand fields differ
(the brand, and the company that makes it). Both counted as fitting saved products, so the shops were
asked for one product only.

**Change.** `isSameProduct` also treats two records as one product when the brands differ but all of
these hold:

- one brand field is a company (`isCompanyBrandField`: a listed maker, or 「…株式会社」「…製薬」
  「…ヘルスケア」);
- the full ingredient lists are the same (`sameIngredientList`);
- one name's key, without the brand, contains the other's, and the shorter key has at least 8
  characters (「ハンドクリーム」 is too general).

This is narrow on purpose. Two different brands with the same name and list stay apart; an existing
test (193) requires that. Every user of `isSameProduct` gets this (the name-search list and the alternatives),
which is wanted: the same product should be listed once everywhere.

## Step 2. A product that isn't the sub-kind asked for doesn't fill an empty slot

**Problem.** 「アルコールフリーのオールインワンジェル」: the shops gave 2. The third slot went to a saved
ヴァセリン petroleum jelly, because loose saved products fill the gap (shop-search-reach.md Step 1), and
for a sub-kind that isn't strict any product of the kind passes.

**Change** (`findAlternatives`): when the request names a **sub-kind**, a saved or shop product can be
shown only if its name says that sub-kind (`subKindFit === 'same'`). A different **form** of the same
sub-kind may still fill a slot: oils for a balm, with the 「バームタイプは見つからなかった」 note. When the
request names no sub-kind, nothing changes.

The checks that decide whether to ask the shops or to run the web step still count all saved
products, as now. So this adds no paid call: when nothing suitable is left, fewer cards are shown and
the reply says why.

## Step 3. The reply names what it shows when the requested form isn't there

**Problem.** 「無香料のボディクリーム」 showed three ボディミルク, and the reply said 「ボディクリームを3件見つけました」.
The 「〇〇タイプは見つからなかった」 note is skipped when the kind's name already says the form, and
ボディクリーム contains クリーム.

**Change** (`summarizeAlternatives`). When the requested form is missing from every card:

- If all cards share one form that has a body-care name, the reply names that form:
  「「香料」を含まないボディミルクを3件見つけました」.
- When the requested name itself says the form (ボディクリーム), the note reads
  「ボディクリームは見つからなかったため、ボディミルクを表示しています。」.
- When the forms are mixed, the reply calls them 「ボディケア用品」 and the note reads
  「ボディクリームは見つからなかったため、ほかのタイプのボディケア用品を表示しています。」.
- Other kinds keep today's note.

## Step 4. Brand lines: ヴァセリン, ユニリーバ and 松山油脂

**Problem.** A saved ヴァセリン product shows the brand 「ユニリーバ・ジャパン・CM」 and searches Amazon for it.
A 松山油脂 listing shows the line name 「肌をうるおす」 as its brand.

**Change** (`brands-jp.ts`):

- Add ヴァセリン (aliases Vaseline, バセリン).
- Add ユニリーバ as a maker (aliases Unilever, ユニリーバ・ジャパン). A company brand field with a listed
  brand in the name then shows that brand, and the Amazon words drop the company (`labelBrandName`,
  `buildAmazonAffiliateUrl`).
- Add 松山油脂. `brandOf` then finds it in the listing name.
- The card name also drops the brand when it comes again as the **last** word
  (「… セラミド 松山油脂」).

## Step 5. Names: 「本体」 between separators and keyword lists

**Problem.**

- 「アミノモイスト モイストチャージ ミルク / / 100g / 無香料」: 本体 was removed and left 「/ /」.
- 「ホワイトクエスト 本体/無香料 アイクリーム」: 本体 was kept because it is joined to 「/」.
- 「オールインワンジェル 化粧水 美容液 乳液 クリーム ヒト型セラミド 保湿 界面活性剤フリー …」: a list of
  kinds after the product's own.

**Change** (`listing-name.ts`):

- 本体 is removed when it stands between spaces or separators. Doubled separators then collapse, and
  separators left at either end are removed (for the card name and the Amazon/Qoo10 words).
- `withoutNameTail` cuts at a run of three or more kind words, when an earlier word already names a
  kind (「… オールインワンジェル 化粧水 美容液 乳液 …」→「… オールインワンジェル」).

## Step 6. A Yahoo! link on a 楽天 card when Yahoo! sells the same item

**Request.** When the card shows a 楽天 listing and Yahoo!ショッピング sells the same item, add a link to
the Yahoo! listing.

**Same item**, as strict as the existing 楽天-by-JAN step (2b), so the link never points to a different
variant:

- The card came from a Yahoo! item found on 楽天 by its JAN code (2b). That Yahoo! item is the twin.
- Or a Yahoo! item from the same search has a JAN code that the 楽天 listing also carries (in its
  description or name, `listingCarriesJan`), its name agrees (`sameJanListing`), it has the same
  variant marks (`variantMarks`), and it is a single item (`notSingleItem`).

**Change:**

- `Product.yahooLink?: { href; sponsored }`, built with `shopLink('yahoo', url)` (the ValueCommerce
  link when configured). Like `shopLink`, it is for display only and never saved.
- The credits include Yahoo! when a Yahoo! link is shown (Yahoo! API terms).
- The card (`ProductSuggestionCard`): the Yahoo! button always reads 「Yahoo!ショッピングで見る」, because
  the price shown is 楽天's. When it is there, the 楽天 button reads 「楽天市場で見る」. Otherwise it stays
  「販売ページを見る」.
- `yahooLink` is removed from a shared routine (`routine-share.ts`) and checked like `shopLink` when a
  product comes from the browser (`product-validation.ts`).
- The same https check as `shopLink` applies.
- Out of scope: the search result summary (`ShopProductSummary`), which shows one listing.

## Not changing

- サーフィン as the brand of the COCOSUNSHINE sunscreen: still needs a brand entry, which we can't guess.
- A single-word tag such as 「[リップクリーム]」 (kept so that a shade such as 「[01]」 isn't removed).

## Tests

Next numbers from 207.

- 207 (step 1): the two ミノン records are one product. Different brands with different lists, or with
  a generic contained name, stay apart.
- 208 (step 2): for an all-in-one gel request, a saved product not named オールインワン isn't shown, even
  when slots are empty. For a balm request, saved oils still fill (same sub-kind).
- 209 (step 3): the body-cream reply with three ボディミルク, with mixed forms, and the 乳液 case unchanged.
- 210 (steps 4 and 5): the brand lines and Amazon words for ヴァセリン/ユニリーバ and 松山油脂; 本体 and
  separators; the keyword list.
- 211 (step 6): a 楽天 card gets the Yahoo! link (via 2b, and via a JAN the 楽天 listing carries). No
  link for a different variant, a set, or a name that disagrees. Credits include Yahoo!. The card
  renders both buttons.
- A mutation check for each step, the full gates, and a live check.

## Implementation notes

- Steps 1–6 as planned, deployed as `fbf39df`. Tests 207–211. Tests 173, 188, 191, 192 and 202 were
  updated for the intended changes. Every step's test fails with that step taken out.
- The live check after `fbf39df` showed step 1 working: the 第一三共ヘルスケア record was merged and
  「/ /」 and 松山油脂 were fixed. It also found a new duplicate. The saved ミノン record (brand field
  「ミノン / MINON」, name without the brand) and the 楽天 listing 「ミノンアミノモイストモイストチャージミルク」
  were both shown. The shop step's series key didn't match them. Before step 1, the 第一三共ヘルスケア record
  had happened to exclude the listing.
- Follow-up (test 212, not deployed yet):
  - **Same brand, contained name.** `isSameProduct` now also merges records of the same brand when the
    full lists match and one name contains the other.
  - **Variant boundary** (review). A contained name followed by a variant mark is a different variant:
    「ローション I」 vs 「ローション II」, 「スネイル9」 vs 「スネイル96」.
  - **Shop vs saved.** `findAlternatives` drops a shop product that `isSameProduct` matches with a saved
    one, on the path that returns without the web step. The web path already did this.
  - **`registeredMatcher`** (review) now applies the same contained-name rule as `isSameProduct`.
  - **Browser storage** (review). `withoutShopData` removes `shopPrice`, `shopLink` and `yahooLink` when
    the 「使えるコスメ」 list is saved or read, and when a routine is shared.
  - **Cheaper checks first** (review). The cross-brand check compares list lengths and name containment
    before the company lookup and the ingredient matching.
- Review, declined:
  - A short result after the sub-kind filter doesn't fall through to the web step. That would add paid
    calls, which this plan rules out. The reply explains the shortfall.
  - Memoising `isCompanyBrandField`. With the cheap checks first, it runs only for near matches.
- Gates: `tsc`, `eslint`, `npm test` 212/212.
- Live check of `d584c96`: the ミノン milk still showed twice. The real 楽天 name is
  「ミノンアミノモイストモイストチャージミルク(100g)【MINON(ミノン)】[敏感肌 乾燥肌 低刺激 アミノ酸 保湿 乳液 濃厚]」,
  and the name containment compared raw names. Both lists were the same 54 ingredients. `containedName`
  now compares the cleaned names (`listingSearchName`, the same cleaning as the Amazon/Qoo10 words).
  Test 212 uses the real name and fails without the cleaning.
