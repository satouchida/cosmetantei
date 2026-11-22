# Plan: shop search reach (live review of 2026-11-22)

Written 2026-11-22. Status: implemented 2026-11-22 (tests 202–204).
Follows the live check of `286b4a2` (Cloudflare version `cadab682`): seven request searches, with the
`[alternatives]` log line read from `wrangler tail`.

Rules that hold for every step (from [alternative-search-improvements.md](alternative-search-improvements.md)):

- Code decides what is shown. No model chooses or ranks a product.
- What goes to the shops is the kind's name and fixed words only.
- 「原因成分フリー」 still means the avoided ingredients were checked against a list we could read.
- No new paid call. The shop APIs are free; the web research step (Gemini + web search) runs only
  when it ran before.

## What the live check found

| Request | Log | What was shown |
|---|---|---|
| 無香料のクレンジングバーム | `saved: 3`, `answeredBy: saved`, `shop: null` | 3 cleansing oils, 「バームタイプは見つからなかった」 |
| ノンケミカルの日焼け止めスティック | `avoid: 0`, `terms: [スティック]`, `shop: null` | 3 gel/milk sunscreens; UV absorbers never checked |
| 無香料のリップクリーム | `subKind: lip_care`, `saved: 3`, `shop: null` | 3 shades of a lip product whose name doesn't say リップクリーム |
| 無香料のボディローション | `answeredBy: shop` | the same ヴァセリン lotion twice (¥864, ¥980), names ending in shop tags |

## Step 1. Loose saved matches don't stop the shop search

**Problem.** `findAlternatives()` asks the shops only when fewer than 3 saved products pass. A saved
product passes when it is the right kind, even if it is not the sub-kind or form that was asked for
(`findSafeAlternatives` uses sub-kind and form only to sort). So three cleansing oils answer a request
for a balm, and the shops are never asked.

**Change** (`src/lib/services/alternatives-service.ts`):

- New `fitsRequest(product, req)`: the product is the sub-kind asked for (`subKindFit(...) === 'same'`,
  when the request has a sub-kind) and the form asked for (`formProfile(name).form === req.profile.form`,
  when the request has a form). With neither, every product fits (behaviour unchanged).
- `findAlternatives()`:
  - Stop before the shops only when **fitting** saved products reach the limit.
  - Otherwise ask the shops for `limit − fitting` products, excluding every saved product found.
  - If saved + shop products reach the limit, return them without the web step (as before: a loose
    saved product still fills a gap rather than paying for web research).
  - Order everywhere: fitting saved → fitting shop → loose saved → loose shop. A fitting shop balm comes
    before a saved oil.
  - The web step's merge uses the same order.
- Log: add `fitting` (how many saved products fit) to `[alternatives]`, so a live check can see why the
  shops were or weren't asked.

The request's form already comes from three places (typed request, analysed product, routine's most
common form). All three now ask the shops when the saved pool lacks that form. The shop API is free, so
this adds no cost.

## Step 2. 「ノンケミカル」 and 「紫外線吸収剤」 mean "no UV absorbers"

**Problem.** The request reader (`findIngredientsInText`) knows no word for UV absorbers, so
「ノンケミカルの日焼け止め」 avoids nothing and `shopTerms` never sends ノンケミカル.

**Change** (`src/lib/services/chat-replies.ts`, `alternatives-service.ts`):

- `INGREDIENT_GROUP_WORDS` gets:
  - `ケミカル` → the `uv_filter` ingredients except 酸化チタン and 酸化亜鉛 (scatterers, which ノンケミカル
    products use), **only when negated** (ノンケミカル, ケミカルフリー, ケミカル不使用). A bare 「ケミカル」
    is too vague to mean UV absorbers (「ケミカルピーリング」 is already cut by the word-boundary rule).
  - `紫外線吸収剤` → the same members (「紫外線吸収剤不使用」「紫外線吸収剤フリー」「紫外線吸収剤が入っていない」).
- Group members are chosen per word, not only by category. `isNegatedInText` uses the same membership,
  so 「酸化チタン配合のノンケミカル」 still allows 酸化チタン.
- The reply names the group: 「紫外線吸収剤」を含まない日焼け止め, not the first three of ten absorbers
  (`avoidedNames`). Groups without a label (アルコール) keep naming their members, as now.
- Shop words: unchanged; `shopTerms` already turns `uv_filter` into ノンケミカル.

## Step 3. Shop tags after the product name, and the duplicate they cause

**Problem.** Raw 楽天 names seen in the check:

- 「ヴァセリン インテンシブケア アドバンスドリペア ボディローション 無香料　400ml ヴァセリン ヴアセリンアドバンスムコウ400」
  (the brand again, then the shop's stock code)
- 「… 無香料 ボディローション・ジェル」, 「… Vaseline ボディーローション・ミルク・トナー」 (楽天 genre names)
- 「… 大容量 400ml 無香料 ボディローション」 (the kind word again)

The card names keep these tails, so the Amazon/Qoo10 search words do too, and two listings of one
product get different keys and both show.

**Change** (`src/lib/search/listing-name.ts`, in `withoutSearchTags`, which both `displayListingName` and
`listingSearchName` use):

- Cut from a later whole-word repeat of the **first** word (≥ 2 characters, not a kind word), when at
  least two words come between.
- Drop a last word made only of kind/form words joined by 「・」 when an earlier word already names a kind.
- Drop a last word that repeats an earlier word.
- If nothing would be left, keep the name (as now).

`shop-alternatives.ts`: the duplicate key (`listingKey`) uses the same cleaning, so the two ヴァセリン
listings become one candidate.

## Not changing

- Shades shown as separate products from the saved pool (リップモンスターQ Q01/Q02/Q03). Step 1 means a
  lip-balm request now asks the shops instead of filling with them; merging shades is separate work.
- The daily spend cap and the paid lookup budget.

## Tests

Next free numbers from 202.

- 202 (step 1): with the saved pool stubbed to loose matches only, the shop search is called and a
  fitting shop product is shown first; with three fitting saved products the shop search isn't called;
  with no sub-kind or form, behaviour is unchanged.
- 203 (step 2): 「ノンケミカルの日焼け止め」 avoids the absorbers but not 酸化チタン/酸化亜鉛; 「紫外線吸収剤不使用」
  the same; 「ケミカルピーリング」 and a bare 「ケミカル」 avoid nothing; the reply says 「紫外線吸収剤」.
- 204 (step 3): the three raw names above clean to 「インテンシブケア アドバンスドリペア ボディローション 無香料」
  (display, brand removed) and the Amazon words drop the tails; names that must stay whole stay whole.
- Mutation check for each: the test fails with the change taken out.
- Full gates: `npx tsc --noEmit -p .`, `npx eslint src tests scripts next.config.mjs`, `npm test`.
- Live: the four requests in the table above, with the log line.

## Implementation notes

- Steps 1–3 as planned. Tests 202–204; tests 106 and 164 updated (106: a mask saved by an earlier test
  and not named シートマスク now sorts after the shop's シートマスク; 164: the new `fitting` field).
- Each step's test fails with that step taken out (mutation check).
- Review (code-improver), fixed:
  - When saved products alone would fill the list, the shop search runs with **paid lookups off**, so
    the change adds no paid call (test 202 checks `paidLookups: 0` with a Yahoo! JAN item present).
  - `avoidedNames` matches group members by their database ingredient, so a routine culprit written
    「オキシベンゾン」 is not listed beside 「紫外線吸収剤」.
  - The repeated-last-word rule leaves number-only words (shade 「0」「01」).
- Review, declined: a deny-list of generic first words (薬用・無添加 …) for the first-word cut. It would
  be a guess without real listings; the cut needs the word repeated with two or more words between, and
  only removes the tail after the repeat.
- Gates: `tsc`, `eslint`, `npm test` 204/204.
