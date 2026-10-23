# Showing standard-violating and 表示指定 ingredients clearly

Written 2026-10-23. Status: implemented 2026-10-23 (not committed). Test 122.

Follows the design critique of the pre-publish audit fixes (`docs/plans/pre-publish-audit-fixes.md`,
deployed in `d2134d7`). Seen in the dev gallery screens `analysis-standard` and
`suggestions-shop-listing`, added for the critique and not yet committed.

## Problems

1. **The cause of 「日本の化粧品基準の注意あり」 is the faintest pill.** In `analysis-standard`,
   ホウ酸 (banned in all cosmetics) shows as a dashed 「？ 未評価」 pill, while セタノール, EDTA and BHT
   show yellow. The headline points at an ingredient the list plays down.
2. **Raised 表示指定成分 contradict themselves.** セタノール's detail shows the 「軽度の注意」 badge and
   the advice 「通常の配合量では刺激になりにくい成分です」. The reason for the yellow (旧表示指定成分)
   is in the small grey note further down.
3. **The banned ingredient's advice suggests trying the product.** ホウ酸 is unrated, so the detail
   falls back to 「…腕の内側などの目立たない部分で試してから使用してください」.

## Changes

### Step 1: mark the raise explicitly (`raisedForLabel`)

`analyzeProduct` already computes `raisedForLabel` (`ingredient-analyzer.ts`). Store it on the
ingredient as `raisedForLabel?: true` (`AnalyzedIngredient` in `src/lib/types/index.ts`), so the UI
doesn't re-derive it from `jpDesignated` + `matchedKnown.riskLevel`.
- Use the flag in `alternativeAvoidItems` and the 「やや注意」 summary filter, instead of comparing
  with `matchedKnown?.riskLevel`. Same behaviour, one source of truth.
- The 「AIで解説」 merge in `IngredientAnalysisCard.tsx` sets or clears the flag together with the
  raised `riskLevel` it already keeps.

### Step 2: pills for ingredients outside the standard (problem 1)

When `ing.jpStandard?.notAllowedHere`, the pill:
- uses a white background with a solid rose border and rose text (`bg-white text-rose-900
  border-rose-400 font-semibold`). This is distinct from the rose-filled 「高」 pill and from the
  dashed 未評価 pill.
- shows the mark 「基準」 instead of the risk mark. **Changed after the code review:** an ingredient that is
  also rated 高・刺・活 keeps that colour and shows 「基準・高」 (for example メチルクロロイソチアゾリノン in a
  leave-on product, which is both), so the irritant rating isn't hidden.
- keeps the risk label for screen readers, and adds 「（日本の化粧品基準で配合できない成分）」 in
  `sr-only`.

The legend adds 「基準＝日本の化粧品基準で配合できない」 when such a pill is present.

Only `notAllowedHere` ingredients get this. Ingredients with a concentration limit (別表第2〜4 with
a number) keep their normal pill and grey 📋 note: the label can't show whether the limit is met.

### Step 3: the raised ingredient's detail (problem 2)

When `raisedForLabel`:
- **Badge:** 「表示指定成分」 in the same amber style as 「軽度の注意」, instead of 「軽度の注意」.
- **Advice:** replace the rule's advice (written for a `safe` rating) with 「表示指定成分です。この成分で
  肌に合わなかったことがある方は、避ける目安にしてください。」. No 「刺激になりにくい」 next to a yellow pill.
- **Legend:** when any pill is raised, the 注 entry reads 「注＝軽度の注意・表示指定成分」. (Superseded
  2026-10-23: raised pills are marked 表, with their own entry 「表＝表示指定成分」; `docs/plans/live-review-4-fixes.md`.)
- The 🏷️ note with the 告示 links stays as it is.

### Step 4: no "try it" advice for ingredients outside the standard (problem 3)

When `jpStandard?.notAllowedHere`, the advice line reads 「日本の化粧品基準で、この製品には配合できない成分
です。使う前に、成分表示と販売元の情報を確かめてください。」 whatever the rating. The red 📋 line with the
告示 link stays. Step 4 wins over step 3 if both apply (a designated ingredient that is also
restricted).

Keep the advice choice in one small function in the card file (`adviceFor(ing)`), so the order of the
three cases (outside the standard → raised → the rule's or fallback advice) is in one place.

### Step 5: gallery and tests

- Commit the two gallery screens (`analysis-standard`, `suggestions-shop-listing`) and their
  fixtures (`importedCream`, `rakutenListing`).
- Test: `analyzeProduct(importedCream)` gives ホウ酸 `jpStandard.notAllowedHere` and セタノール
  `raisedForLabel`; water has neither. Source checks for the pill mark, the legend text, the badge
  label and `adviceFor` order (the suite checks components by source, as in tests 117 and 121).
- `pnpm check:responsive -- --only=analysis` and the code-improver review.

## Not changing

- **Pill colour of raised ingredients.** Still amber; the owner chose yellow for them. Only the
  wording changes.
- **The product verdict.** Unchanged (owner decision in the audit plan, step 4c).
- **The 「Supported by Rakuten Developers」 touch target.** It's a vendor attribution snippet, outside
  this change.

## Review (2026-10-23, before implementing)

- **Accessibility:** the 「基準」 mark is `aria-hidden` like the other marks, so the `sr-only` text has
  to carry the meaning. Added that to step 2.
- **Overlap:** a 表示指定成分 that is also `notAllowedHere` would get both treatments. Step 4 now says
  which wins, and the pill shows 「基準」 (step 2), so the two never show at once.
- **Wording check:** the new advice texts pass `hasProhibitedClaim` (no assurance, no efficacy); the
  test runs them through it.
- **Scope:** quasi-drugs never get `jpStandard`, so they're unaffected. `outsideJpStandard` (headline)
  and the pills use the same `notAllowedHere`, so the headline and the marked pill always agree.

## Code review (after implementing)

- **Fixed (Medium):** the 「AIが評価した成分」 list still used the plain risk label, so an AI-rated
  表示指定成分 showed 「軽度の注意」. It now uses `riskLabelFor` like the pill and the detail.
- **Fixed (Low):** a pill outside the standard hid a 高・刺・活 rating. It happens for
  メチルクロロイソチアゾリノン in leave-on products. See step 2.
