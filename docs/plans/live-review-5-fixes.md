# Fixes from the fifth live UI review (2026-10-24)

Written 2026-10-24. Status: implemented 2026-10-24 (not committed). Test 127.

Follows the live review of `0ef1fd5` (Cloudflare version `47688e8c`), which checked the fixes in
`docs/plans/live-review-4-fixes.md`. Those worked: セタフィル モイスチャライジングローション shows 表 on
セテアリルアルコール, exactly three 注 buttons matching 「軽度の注意の成分（3成分）」, and the legend
「注＝軽度の注意　表＝表示指定成分」. The review found no problem at Minor or above, and noted one
point to watch.

## Problem

**表 and 注 buttons look the same apart from the letter.** Both use the amber fill of
`RISK_SCALE.low_caution.pill`, because a raised 表示指定成分 has `riskLevel: 'low_caution'`. Since the
last change they mean different things: 注 counts toward 「やや注意」 and is named in the reason line, and
表 doesn't. Someone scanning the list by colour still groups セテアリルアルコール with the three mild-caution
ingredients, and has to read a one-character mark to tell them apart.

## Change

### Step 1: raised 表示指定成分 get a yellow outline on white

`IngredientAnalysisCard.tsx`, `getPillStyle`: a raised ingredient (`raisedForLabel`) that isn't outside
the standard gets `bg-white text-amber-900 border-amber-400 hover:bg-amber-50`.

- **It stays yellow.** The owner chose yellow for these ingredients
  (`docs/plans/standard-and-designated-display.md`, 「Not changing」), so they still don't sit with the
  green 「刺激の報告が少ない」 ones or the plain white safe ones. Only the fill goes.
- **It follows the 基準 pattern.** Marks that come from a Japanese list (基準: white with a red
  outline) are outlined; marks that come from the irritation rating (高・刺・活・注) are filled. 表 is
  the second kind of list mark, so it gets an outline in its own colour.
- **Order:** after the outside-the-standard check, so a raised ingredient outside the standard keeps
  the red 基準 outline, as now (its mark is 基準 only).
- `amber-400`, not the 注 pill's `amber-300`: on white, the lighter border is hard to see. 基準 uses
  `rose-400` for the same reason.
- No `font-semibold`. 基準 is bold because it's the card's headline reason; 表 isn't a reason.

## Not changing

- **The detail's 「表示指定成分」 badge.** It stays the amber `riskBadge('low_caution')`. It is
  labelled in words, so it doesn't need the button's outline to be told apart.
- **The legend.** 「表＝表示指定成分」 already explains the mark; the colour only adds a second cue.

## Tests and checks

- Test 127 (source check, as test 122 does for 基準): `getPillStyle` returns the outlined amber style
  for `raisedForLabel`, and that check comes after the outside-the-standard one.
- Gallery `analysis-standard` and `analysis-ai` at 390 px; `pnpm check:responsive -- --only=analysis`.
- Code-improver review skipped: a one-line style change (the user's review rule).

## Implementation notes

- Test 127 as planned; the suite passes (127 tests).
- `analysis-standard` at 390 px: セタノール, ステアリルアルコール, EDTA-2Na and BHT are yellow outlines on
  white; ホウ酸 keeps the red 基準 outline. `analysis-ai`: the three 注 buttons are still filled.
  `pnpm check:responsive -- --only=analysis`: 0 breaks.
