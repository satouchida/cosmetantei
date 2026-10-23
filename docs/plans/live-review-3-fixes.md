# Fixes from the third live UI review (2026-10-23)

Written 2026-10-23. Status: implemented 2026-10-23 (not committed). Test 125.

Follows the live review of `9bf94e7` (Cloudflare version `5d3bb457`), which checked the fixes in
`docs/plans/live-review-2-fixes.md`. Those worked; the review found three new problems, all in the
chat message above a product's analysis card. They have one cause, so one change fixes them.

## Problems

1. **The message and the card give different verdicts.** For セタフィル モイスチャライジングローション
   the message says 「既知の刺激成分は見当たりませんでした」. The card then has the AI rate the 2
   ingredients the database doesn't know. セテアレス-20 comes back as 軽度の注意, which makes 3
   mild-caution ingredients, and the card's verdict changes to 「敏感肌はやや注意」. The message was
   written on the server before the AI ran and never changes. The same can happen to its
   「注意したい成分」 list (the AI can add one), and to a product with too few rated ingredients (the
   AI can rate enough of them for a verdict).
2. **The counts are phrased differently.** The message says 「「パンテノール」「ナイアシンアミド」
   「ジメチコン」ほか2件」; the card shows 2 items and 「ほか3成分の説明」. Both mean the same 5.
3. **The message repeats the card.** `summarizeProductAnalysis` puts `summaryJa` in the message; the
   card shows it again right below. The marketplace notice (`dataSourceDisclaimer`) is also in both.
   The "no data" reply stopped doing this in the last round; replies for products with a list didn't.

A smaller, related gap on the card: when the AI rating changes the verdict, a sighted user sees the
「AIで調べています…」 panel disappear and the verdict change, with nothing saying why. The line
「AIで2成分を評価し、結果に反映しました。」 exists, but only for screen readers (`sr-only`).

## Changes

### Step 1: the message says what can't change; the card holds the verdict (problems 1–3)

`chat-replies.ts`, `summarizeProductAnalysis`, for a product with an ingredient list (both the rated
case and the 「評価できた成分が少ない」 case):

- 「「{name}」の全{n}成分を確認しました（成分の出典: {source}）。」 — with a barcode,
  「バーコード（…）の製品は「{name}」です。全{n}成分を確認しました（…）。」. No source → no brackets.
- 「判定と成分ごとの説明は、下のカードをご覧ください。」
- No `summaryJa`, no 「注意したい成分」 or 「肌を整える・うるおいを保つ成分」 lists, no
  `dataSourceDisclaimer`. The card shows all of them, and only the card is updated after the AI
  rating. The ingredient count, the product and the source don't change, so the message stays true.
- The "no data" branch (empty list) is unchanged.
- `listNames` is no longer used; remove it.
- Check the new texts with `hasProhibitedClaim`.

The card is always right under the message: the server sends `singleAnalysis` with every reply that
uses this text (`api/chat/route.ts`), and the chat isn't saved and reloaded without its cards.

Update the T6 row in `docs/plans/gemini-role-redesign.md` (「summary, caution and soothing
ingredients, source site」 → count and source; the verdict is on the card).

### Step 2: say on the card that the AI rating was applied (the related gap)

`IngredientAnalysisCard.tsx`: when `aiEvaluation.evaluatedCount > 0`, show the existing sentence
under the summary as a small muted line (`text-xs text-ink-muted`), for everyone:
「成分データに無い{n}成分はAIで評価し、判定に含めています（目安）。」

- Keep the `sr-only` status region for the announcement; mark the visible line `aria-hidden` so a
  screen reader doesn't read the same fact twice in a row. (The status region's text stays in the
  page, so it's still found when reading the card later.)
- Not shown when the AI rated nothing (`evaluatedCount === 0`) or wasn't asked (typed labels,
  marketplace estimates, shop listings).

### Step 3: tests and checks

- Test 125:
  - `summarizeProductAnalysis` of a rated product → contains 「全{n}成分を確認しました」 and
    「下のカードをご覧ください」; does not contain `summaryJa`, 「注意したい成分」, 「ほか」 or the
    disclaimer; with a barcode, starts with the barcode wording; a `web_page` source shows its host.
  - The 「評価できた成分が少ない」 product → the same shape, no `summaryJa` (test 124's `fewReply`
    assertion changes from 「includes summaryJa」 to 「doesn't」).
  - The "no data" reply is unchanged (test 124 still passes).
  - Every new text passes `hasProhibitedClaim`.
- Gallery: no fixture has `aiEvaluation` yet, so add a screen `analysis-ai` (an analysis with
  `aiEvaluation: { evaluatedCount: 2 }`);
  `pnpm check:responsive -- --only=analysis` and the code-improver review.

## Not changing

- **Writing the message after the AI rating.** The message would wait for a second, slower call, and
  the card already shows progress. Keeping the message to facts that don't change is simpler.
- **The tray's missing つめかえ用 listing.** `NOT_SINGLE_ITEM` doesn't match its name; the shops'
  results most likely changed. Nothing to fix unless it shows up again.

## Implementation notes

- **Step 2 dropped.** After the AI rating the card's summary already ends with 「2成分は成分データに無い
  ため、AIが評価しました（誤りを含む可能性があります）。」 (`analyzeProduct`, `aiEvaluatedCount`), and
  the rated pills carry an 「AI」 mark. The live review read the `sr-only` line and missed this. A second
  line would say the same thing again, so the card is unchanged.
- **Gallery:** `analysis-ai` uses `aiRatedLotion` with `aiRatings` (セテアレス-20 → 軽度の注意,
  パントラクトン → 問題なし). The verdict changes from 「刺激になりやすい成分なし」 to 「やや注意」, as
  セタフィル did live. Test 125 checks that the reply is the same before and after the rating.
  `pnpm check:responsive -- --only=analysis`: 0 breaks.
- **Test 54** asserted the old reply's ingredient names; it now checks the count line and that the
  caution ingredient is in `singleAnalysis`.


## Follow-up: design critique of the changed card (2026-10-23, implemented, not committed)

A design critique of the gallery screen `analysis-ai` (390 px), after the change above, found two
problems on the card. Neither is new, but the first matters more now that the chat message no longer
names any ingredients.

### Problems

1. **The reason for 「やや注意」 has no list on the card.** The verdict is `caution` when there are
   3 or more mild-caution ingredients (`riskCounts.low_caution >= 3`; raised 表示指定成分 aren't counted).
   The 「敏感肌への注意・刺激成分」 box (`warningsJa`) lists only moderate, strong and active ingredients.
   So when the verdict comes from mild-caution ingredients alone, the card names none of them. The
   summary says 「一部に防腐剤など」, and the reasons are only the 注 marks on 3 of 8 buttons, below the
   green box. (Live: セタフィル, with セテアレス-20, 安息香酸Na and ベンジルアルコール.)
2. **The list heading breaks inside its count.** At 390 px, 「全成分リスト (8成分)」 wraps as 「(8成」 /
   「分)」, because the hint 「タップで成分解説を表示」 shares the row.

### Changes

**Step 4: name the mild-caution ingredients when they are the whole reason (problem 1).**
A pure helper `mildCautionNames(analysis)` in a new `src/lib/caution-reason.ts` (client-safe, testable
without rendering the card) returns the names, or none. `IngredientAnalysisCard.tsx` shows them as one
plain line under the summary, when `overallRiskLevel === 'caution'` and `warningsJa` is empty:
「軽度の注意の成分（3成分）: セテアレス-20（AIの評価）、安息香酸Na、ベンジルアルコール」

- The names are the ingredients with `riskLevel === 'low_caution'` and not `raisedForLabel`: the same
  set the verdict counts (and `alternativeAvoidItems` uses), in list order. `（AIの評価）` follows an
  AI-rated name, as the 「AI」 mark on its button does.
- The label comes from `riskOf('low_caution').label`, so it matches the legend 「注＝軽度の注意」.
- Plain small text (`text-sm`), not a warning panel: these ingredients are mild, and a red box would
  outweigh the 「やや注意」 badge. Not a button list either; the buttons below already open each one.
- Not shown when `warningsJa` has items (that box already gives the reason), for `safe`, `warning` or
  `insufficient_data`.
- Check the line with `hasProhibitedClaim`.

**Step 5: keep the count with its heading (problem 2).** Wrap 「({n}成分)」 in a
`whitespace-nowrap` span, so the heading breaks before the count, not inside it. The hint keeps its
place and wraps on its own.

### Not changing

- **The source shown twice** (「成分の出典: …」 in the message, 「出典: …」 linked on the card). The
  message is read on its own by screen readers and in notifications; the card's line is the link.

### Tests and checks

- Test 125, extended:
  - `mildCautionNames` of the gallery's AI-rated analysis: the 3 ingredients in list order, with
    セテアレス-20 marked as AI-rated. (No test renders a client component today; the helper keeps the
    logic testable, and a source check covers the card using it.)
  - An analysis that is `caution` because of an active or moderate ingredient (`warningsJa` not
    empty) → no line. A `safe` analysis → no line. A product whose 3 mild ones are all raised
    表示指定成分 isn't `caution`, so no line.
  - The line passes `hasProhibitedClaim`.
  - Source check: the heading's count is inside a `whitespace-nowrap` span.
- `pnpm check:responsive -- --only=analysis` (320 px and 200 % text in particular), a screenshot of
  `analysis-ai` at 390 px, and the code-improver review.

### Follow-up: implementation notes and code review

- `src/lib/caution-reason.ts` (`mildCautionNames`) and the card line as planned. At 390 px and 320 px
  the line reads as plain text under the summary; the heading now breaks as 「全成分リスト」 /
  「(8成分)」. `pnpm check:responsive -- --only=analysis`: 0 breaks.
- Test 124's heading regex now allows a JSX comment before the `<h3>`.
- **Code review:** no Critical or High findings. The reviewer confirmed the helper's set is exactly
  what `riskCounts.low_caution` counts, and that with `caution` and no warnings there are at least 3.
  - **Declined (Medium):** a repeated ingredient would list its name twice. Checked: `analyzeProduct`
    merges exact repeats, and two spellings (安息香酸Na, 安息香酸ナトリウム) keep their own names, so no
    name repeats. Test 125 covers the repeat.
  - **Done (Low):** a `warning` verdict case in test 125.
  - **Declined (Low):** a render test instead of the source checks (no test renders a client component
    today; the logic is in the helper); showing label wording instead of the database name (the
    buttons use the same names); muting the line's colour (the plan keeps it at the summary's weight,
    since it is the reason for the verdict).

