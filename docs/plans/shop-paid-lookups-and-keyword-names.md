# Plan: paid lookups when saved products can't be shown, and keyword lists after the kind name

Written 2026-11-23. Status: implemented and deployed 2026-11-23 (tests 216–217).
Follows the live check of `9358aa1` (Cloudflare version `bd700bf2`): eight request searches, with the
`[alternatives]` log line. Earlier round: [yahoo-search-link.md](yahoo-search-link.md).

These rules still hold:

- Code decides what is shown.
- The shops get only fixed words.
- Logs hold counts and fixed words only.
- Paid lookups are made only when they can add a card that would otherwise be missing.

## What the live check showed

- 「アルコールフリーのシートマスク」 showed **1 card**. Three saved masks were found, but only one is a
  sheet mask (`fitting: 1`). The two others can't fill a slot, because the request names a sub-kind
  (alternatives-live-review-2026-11-23.md, Step 2). The shops were asked for 2, read 1 of 33 lists, and
  made **no paid lookups** (`paidLookups: 0`).
- 「紫外線吸収剤が入っていない日焼け止めミルク」: a 楽天 card was named 「シルキーUVミルク spf50+ PA++++ 日焼け止め
  紫外線吸収剤不使用 ノンケミカル スキンケア 乳幼児試験済み UVカット セラミド 紫外線防止 上原恵理 Dr.BEAUTOPIA」.
- Checked and fine:
  - the 「set」 drops for balms are real multi-packs (「3個セット」「90g×2セット」);
  - the 「+」 in the Qoo10/Yahoo! words is encoded (`%2B`);
  - hair products and positive requests (「セラミド配合」) are out of scope by design.

## Step 1. The paid-lookup check counts only the saved products that can be shown

**Problem.** `findAlternatives` allows paid lookups only when `local.length < limit`. The check was added
so that paid lookups aren't made when saved products fill the list anyway (shop-search-reach.md).
Since the sub-kind rule, a saved product of another sub-kind no longer fills a slot. So the check can
block paid lookups although the list won't be filled.

**Change** (`alternatives-service.ts`): compute `shownSaved = fittingFirst(local, [], req, limit)` once. It
is the list already passed to the shop search. Allow paid lookups when `shownSaved.length < limit`.

- 「シートマスク」 with 1 sheet mask and 2 other masks saved: paid lookups are allowed, for up to 2
  products (`limit - found`, as now).
- 「クレンジングバーム」 with 3 saved oils: the oils still fill (same sub-kind, other form), so there are
  still no paid lookups (test 202).
- A request without a sub-kind: every saved product of the kind fills, as now.

**Not changing.** The check that decides whether to run the web step still counts all saved products.
That was decided in alternatives-live-review-2026-11-23.md (review, declined).

## Step 2. A keyword list after the kind's own name is cut

**Problem.** Shops add search keywords after the product name. `withoutNameTail` already cuts a run of
three kind words, but here the words after 「日焼け止め」 are not kind words.

**Change** (`listing-name.ts`, `withoutNameTail`). Cut at a word that is only the kind's name when all of
these hold:

- the word is the kind's plain name: 日焼け止め, サンスクリーン, 化粧水, 美容液, 乳液, クリーム, 洗顔, 洗顔料,
  クレンジング, リップクリーム or パック;
- an earlier word already names the same kind (「シルキーUVミルク」 names a sunscreen);
- at least 3 words follow it, so it starts a list. 「ノンケミカル UVカット 日焼け止め ミルク」 keeps its name.

This applies to the card name and the Amazon/Qoo10/Yahoo! words, since both use `withoutSearchTags`.
For example:

- 「シルキーUVミルク spf50+ PA++++ 日焼け止め 紫外線吸収剤不使用 …」 →「シルキーUVミルク spf50+ PA++++」;
- 「薬用リップケア モイスト リップクリーム 敏感肌用 保湿 無香料」 →「薬用リップケア モイスト」.

## Tests

Next number 216.

- 216 (step 1):
  - 「アルコールフリーのシートマスク」 with 1 saved sheet mask, 2 other saved masks, and a Yahoo! item with a
    JAN code and no list: `paidLookups` is 1;
  - with 3 saved sheet masks, it is 0.
- 217 (step 2):
  - the live sunscreen name and the アベンヌ lip name are cut, on the card and in the search words;
  - names that are kept: a short tail (「ノンケミカル UVカット 日焼け止め ミルク」), a plain name before the
    product (「肌ラボ 極潤 ヒアルロン液 化粧水 …」), and a plain name without an earlier word of the same kind.
- A mutation check for each step, the full gates, and a live check.

## Implementation notes

- Step 1 as planned. The saved masks in test 216 are named 「モイストマスク」 (sub-kind unknown from the
  name), like the live ones: a saved 「クレイパック」 is a different sub-kind and isn't found at all.
  Test 202 still checks that saved oils for a balm request block paid lookups.
- Step 2, changed during the work:
  - Test 205 showed that a size and notes in brackets after the plain name
    (「日焼け止め 14g (顔・からだ用) (SPF50+ PA++++) (ノンケミカル)」) are not a keyword list. Bracketed words
    and sizes don't count toward the 3 words.
  - Test 205's アベンヌ name now reads 「薬用リップケア モイスト」, as planned.
- Review (code-improver), fixed:
  - **Medium.** 「アネッサ UV 日焼け止め ジェル SPF50+ PA++++ 無香料」 was cut to 「アネッサ UV」. There is now
    no cut when the next word is a kind or form word or a number variant (「化粧水 II」), and SPF/PA
    values don't count as keywords.
  - **Low.** A guard so that a plain name with no kind never matches earlier words with no kind.
- Review, declined:
  - Keeping 「モイスチャー ミルク クリーム 保湿 敏感肌 低刺激」 whole. The words after クリーム are
    keywords, so cutting them is the intended rule.
  - Using the showable count for the web-step check too. That was decided earlier
    (alternatives-live-review-2026-11-23.md), because it adds paid calls.
- Each step's test fails with that step taken out, and so does the next-word guard.
- Gates: `tsc`, `eslint`, `npm test` 217/217.
- Live check of `cd75113` (Cloudflare version `c3722a8a`):
  - **Step 1 works.** 「アルコールフリーのシートマスク」 made 2 paid lookups (was 0). Neither found a product
    with a readable list, so it still shows 1 card.
  - **Step 2 missed the real name.** The 楽天 name has the size glued to the word:
    「… PA++++ 50g日焼け止め 紫外線吸収剤不使用 …」. The plain kind name may now start with a size. Test 217
    uses the real name, and fails without this.
