# Plan: no 「ノンケミカル」 search word for 酸化亜鉛・酸化チタン, and one card per product when lists differ only in dashes

Written 2026-11-24. Status: step 2 deployed as `a959e95`; step 1 deployed and then reverted (step 3, test 218), revert deployed 2026-11-24.
Follows the live check of `e83dccb` (Cloudflare version `79c277de`). Earlier round:
[shop-paid-lookups-and-keyword-names.md](shop-paid-lookups-and-keyword-names.md).

These rules still hold:

- Code decides what is shown.
- The shops get only fixed words.
- There are no new paid calls.
- Logs hold counts and fixed words only.

## What the live check showed

- 「酸化亜鉛不使用の日焼け止めスプレー」 sent 「ノンケミカル」「ミスト」 to the shops.
  - `shopTerms` adds 「ノンケミカル」 for every UV filter, including 酸化亜鉛 and 酸化チタン.
  - Non-chemical sunscreens are the ones that use those two mineral filters. So the search asks for the
    products most likely to contain what the user avoids.
  - The ingredient check still drops them, so no card was wrong. But the search wastes its results.
- The same product was shown twice: 紫外線予報 ノンケミカルUVクリアミストM, as listings from two 楽天 shops.
  - Both lists have the same 31 ingredients. One writes 「メチルグルセス−10」「PEG−60」 with U+2212 (minus
    sign), the other with 「-」. NFKC keeps U+2212.
  - The shop search compares lists as exact text (`add` in `shop-alternatives.ts`), so they don't match.
  - The name keys differ too: 「…クリアミストM(30mL)【紫外線予報】[日焼け止め …]」 against
    「「ポイント10倍 11月20〜21日」紫外線予報 ノンケミカルUVクリアミストM 30mL 日焼け止め アットコスメ」.
  - The second listing has no brand, because 紫外線予報 is not in the brand list. So `isSameProduct` would
    not match them either.

## Step 1. 「ノンケミカル」 only for the UV absorbers

**Change** (`alternatives-service.ts`, `shopTerms`). A UV filter adds 「ノンケミカル」 only when it is not one
of the two mineral filters (`UV_SCATTERERS` in `chat-replies.ts`, now exported).

- 「酸化亜鉛不使用」 and 「酸化チタン不使用」 send no ingredient word. The kind and form words are unchanged.
- 「紫外線吸収剤不使用」「ノンケミカル」 still send 「ノンケミカル」 (test 203).
- When both are avoided (「酸化亜鉛と紫外線吸収剤が入っていない」), 「ノンケミカル」 is sent for the absorbers.

## Step 2. Compare ingredient lists after unifying dashes

**Change** (`shop-alternatives.ts`, `add`). The duplicate check compares a normalised list key instead of
the raw text:

- NFKC;
- the hyphen and dash characters (U+2010–U+2015, U+2212) become 「-」;
- spaces are removed.

The rule itself is unchanged: two shop listings with the same full list are one product. Only the
spelling of the list is normalised. 「ー」 (the katakana long vowel) is not changed.

## Not changing

- 紫外線予報 has no brand entry. The second card's brand line came from the first word, which is right.
  A brand entry can come later if the brand shows up more.

## Tests

Next number 218.

- 218 (step 1):
  - 「酸化亜鉛不使用の日焼け止め」 and 「酸化チタンが入っていない日焼け止め」 send no 「ノンケミカル」;
  - the shop request for a 酸化亜鉛 spray has no 「ノンケミカル」 in its keyword;
  - test 203's cases still send 「ノンケミカル」.
- 219 (step 2): the two live listings, with the real names and lists (U+2212 in one), give one card. The
  next listing takes the second slot, and `dropped.duplicate` counts it.
- A mutation check for each step, the full gates, and a live check.

## Implementation notes

- Steps 1 and 2 as planned. Each test fails with its step taken out.
- Review (code-improver), fixed:
  - **Medium.** The name search that reads 楽天 captions (`shop-ingredients.ts`) compared raw lists too.
    `ingredientListKey` now lives in `shop-ingredients.ts` and is used in both places.
  - **Low.** The key is computed once per found product (`listKey` on the `found` entries). Two empty
    lists never count as the same.
  - **Tests.**
    - Test 218 also checks 「紫外線吸収剤不使用」 alone.
    - Test 219 checks the key directly. Full-width brackets, spaces and a U+2010 hyphen are the same.
      PEG-80 against PEG-60, 「ー」 against 「-」, and an extra ingredient are different.
- Review note: `scripts/eval-alternatives.mts` uses `shopTerms`, so its 酸化亜鉛 and 酸化チタン cases no
  longer send 「ノンケミカル」. That matches production; re-baseline those cases if they are measured.
- Gates: `tsc`, `eslint`, `npm test` 219/219.

## Step 3. Revert step 1 (owner's decision, 2026-11-24)

**Live check of `a959e95`** (Cloudflare version `db7f6c8a`):

- **Step 2 works.** 「紫外線吸収剤不使用の日焼け止めスプレー」 still searches 「ノンケミカル」「ミスト」 and finds
  both 紫外線予報 listings. It shows the mist once (`dropped.duplicate` 5, was 4). ミノン UVマイルドミルク takes
  the freed slot.
- **Step 1 made the 酸化亜鉛 search worse.** 「酸化亜鉛不使用の日焼け止めスプレー」 searched only 「ミスト」.

| | Search words | Dropped for 酸化亜鉛 | Dropped as irritant | Shop cards |
|---|---|---|---|---|
| Before | ノンケミカル ミスト | 0 | 4 | the 紫外線予報 mist |
| After | ミスト | 0 | 18 | none |

The reasoning behind step 1 didn't hold. No readable listing was dropped for 酸化亜鉛 either way.
「ノンケミカル」 also keeps out the alcohol-heavy chemical sprays, which matters more.

**Change:**

- `shopTerms` sends 「ノンケミカル」 for every UV filter again, including 酸化亜鉛 and 酸化チタン.
- `UV_SCATTERERS` is no longer exported. Only the reverted code used it.
- 「ノンケミカル」 is only a search word. The ingredients to avoid are unchanged: a 「酸化亜鉛不使用」 request
  still avoids 酸化亜鉛 only, and every card is checked for it.

**Test 218** now checks that 酸化亜鉛, 酸化チタン, the absorbers and both together send 「ノンケミカル」, and
that the shop keyword contains it. It fails with step 1 put back.
