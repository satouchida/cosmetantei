# Fixes from the fourth live UI review (2026-10-23)

Written 2026-10-23. Status: implemented 2026-10-23 (not committed). Test 126.

Follows the live review of `186d545` (Cloudflare version `8c84766a`), which checked the fixes in
`docs/plans/live-review-3-fixes.md`. Those worked: the chat message and the card agree, the card names
the mild-caution ingredients behind 「やや注意」, and the list heading keeps its count whole. The review
found one Minor problem.

## Problem

**Four buttons show 注, but the card's reason line says 3成分.** セタフィル モイスチャライジングローション's
card reads 「軽度の注意の成分（3成分）: セテアレス-20（AIの評価）、安息香酸Na、ベンジルアルコール」, and the
ingredient list has four 注 buttons. The fourth, セテアリルアルコール, is a 表示指定成分 rated 「刺激の報告が
少ない」 and shown in amber so it isn't listed as green (`raisedForLabel`,
`docs/plans/standard-and-designated-display.md`). It doesn't count toward the verdict, so the line
is right to leave it out. But the button carries the same 注 as the mild-caution ingredients, and
only the legend 「注＝軽度の注意・表示指定成分」 and the screen-reader text 「（表示指定成分）」 tell them apart.
Someone matching the line against the buttons finds one too many.

## Change

### Step 1: a mark of its own for raised 表示指定成分

`IngredientAnalysisCard.tsx`:

- `pillMark`: a raised ingredient (`raisedForLabel`, not outside the standard) gets 「表」 instead of
  「注」. The amber colour stays: it still shouldn't sit with the green 「刺激の報告が少ない」 ones, and
  the detail's badge (「表示指定成分」, amber) already matches. An ingredient outside the standard keeps
  「基準」, as now.
- **Legend:** 「注＝軽度の注意」 is listed only when a non-raised ingredient is mild-caution, and
  「表＝表示指定成分」 is added when any button is raised. The combined entry 「注＝軽度の注意・表示指定成分」
  goes. Order: the risk levels, then 表, then 基準.
- The screen-reader text (`riskLabelFor`, 「（表示指定成分）」) and the detail are unchanged.

After this, the 注 buttons are exactly the ingredients the reason line names (both use
`low_caution && !raisedForLabel`).

Why 「表」: the other marks are one character taken from their label (高・刺・活・注・？), and 表示指定成分
starts with 表. The legend says what it means.

Update the legend line in `docs/plans/standard-and-designated-display.md` (step 3) to point here.

## Not changing

- **The reason line's wording.** Adding 「表示指定成分のセテアリルアルコールは数えていません」 would explain
  the gap with more text; giving the button its own mark removes the gap.
- **The raised ingredients' colour.** Changing amber would reopen the decision in
  `standard-and-designated-display.md` (a 表示指定成分 shouldn't look like 「刺激の報告が少ない」).

## Tests and checks

- Test 126:
  - The gallery's `importedCream` (セタノール, EDTA and BHT raised; ホウ酸 outside the standard): source
    check that `pillMark` returns 「表」 for a raised ingredient before the risk mark, and 「基準」 still
    wins for one outside the standard.
  - Legend source check: 「表＝表示指定成分」 present, 「・表示指定成分」 gone, and the 注 entry built from
    non-raised ingredients only.
  - The 注 set equals `mildCautionNames` for the AI-rated fixture plus a raised ingredient
    (`mixed` in test 125): computed from the analysis, not the source.
- Test 122 asserts the old combined legend (`'・表示指定成分'`); change it to the new entry.
- Gallery: `analysis-standard` (raised and outside-the-standard ingredients) and `analysis-ai`;
  `pnpm check:responsive -- --only=analysis`, a 390 px screenshot of `analysis-standard`, and the
  code-improver review.

## Implementation notes

- `pillMark`, `riskLabelFor`, `legendEntries`, `outsideStandard` and `isIrritantLevel` moved from the
  card into `src/components/chat/ingredient-marks.ts`, so test 126 checks the marks and legend the
  card shows, not its source text. Test 122 uses the module too.
- `analysis-standard` at 390 px shows 表 on セタノール, ステアリルアルコール, EDTA-2Na and BHT, 基準 on
  ホウ酸, and the legend 「表＝表示指定成分　基準＝日本の化粧品基準で配合できない」 (no 注 entry: nothing
  there is mild-caution). `pnpm check:responsive -- --only=analysis`: 0 breaks.

## Code review (after implementing)

- **Fixed (Medium):** a mild-caution ingredient outside the standard showed only 基準, while the
  reason line still named it. None in the ingredient database is both (checked every mild-caution
  entry against every product type), but an AI-rated one can be. Such a button now shows 基準・注, as
  高・刺・活 already did, and the legend lists 注. The 注 buttons are now exactly the reason line's names.
- **Fixed (Low):** test 126 re-implemented the 注 rule instead of using the card's marks. It now
  calls `pillMark` and `legendEntries`, and covers a raised ingredient outside the standard (基準 only,
  no 表 in the legend) and the mild one outside the standard (基準・注).
- **Fixed (Low, earlier behaviour):** a raised 表示指定成分 outside the standard was read out as
  「軽度の注意」. `riskLabelFor` now says 「表示指定成分」 for every raised ingredient.
