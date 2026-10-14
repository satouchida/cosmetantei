# 「今使っているコスメ」 and the combination check (2026-10-14)

`UserRoutineState.currentlyUsing` existed since the first commit, but nothing filled it. The
owner asked for it to be built, with a warning when the list holds items added more than three
months ago.

## What the user sees

- **A third button** 「今使っている」 next to 「肌荒れした」 and 「普段使えている」 on the product
  cards, the type-ahead tray and the analysis card.
- **A sidebar section** 「今使っているコスメ」 above the comparison lists. Each item shows the
  date it was added and a delete button. 「組み合わせをチェック」 is enabled with two or more items.
- **The check** sends the list to `/api/chat` with `action: 'check_current_use'`. The server runs
  the Step 5 pair rules (`checkCurrentUse`) and calls no AI. The answer is a card,
  「今使っているコスメの組み合わせ」, with the findings, or a note that none of the checked
  combinations were found and that this doesn't mean other combinations are safe.
- **Wording:** the rules take a context. For the problem products they keep 「一緒に使っていた場合」
  and 「原因を確かめやすく」; for products in use they say 「一緒に使うと」 and suggest using one of
  them if redness appears.

## The three-month check

- Each item stores `addedAt`. An item is stale once three calendar months have passed
  (`isStale`, `STALE_AFTER_MONTHS = 3`).
- A stale item gets an orange border, 「(3か月以上前)」 and a 「今も使っている」 button that resets
  its date to today.
- A banner shows above the chat while any item is stale, naming the items. On phones it has a
  「確認する」 button that opens the sidebar. The sidebar has the same warning.
- The check's result card repeats the warning with the stale names at the time of the check.
  The server never sees the dates; the browser adds them to the card, worded as 「調べた時点で」
  because the card stays in the chat after the user confirms.

## Storage

- The list is saved in this browser's `localStorage` (`cosmetantei:current-use:v1`), read with
  `useSyncExternalStore`, so the server render and hydration see an empty list and there is no
  mismatch. Another tab's changes are picked up through the `storage` event.
- Where storage is blocked, the list works for the open page only.
- **Products from a typed label (`user_label`) are never saved.** They stay in memory for the
  session, and the item says 「入力した成分表示は保存しません」.
- Stored data is checked on load with the same `isValidProduct` the server uses (moved from
  `server/validation.ts` to `src/lib/product-validation.ts`), so a product the server would
  reject can't make every check fail. Bad JSON, duplicates, label products (`user_label`, or an
  id starting with `label_`, as on the server) and anything past 20 items are dropped too. The
  server still validates the list and swaps in its own copy of known products
  (`resolveClientRoutine`).
- The sidebar's 「クリア」 empties the comparison lists only.

## Tests

Test 76 checks the present-tense wording and that the comparison wording is unchanged, the
three-month boundary, the stored-data parsing, that label products are not saved, that the
store works without storage, and that the route needs two products and calls no AI.

Also checked by hand on `wrangler dev`: a 4-month-old item shows both banners, the check
returns the retinoid and salicylic acid finding with the stale note, and 「今も使っている」
clears the banners and saves the new date.

## Code review

`code-improver` found nothing Critical. Fixed:
- **High:** the stored-list check was looser than the server's. One stored product the server
  rejects (a new category, an over-long name) would make every check fail with a generic error
  and survive reloads. The client now uses the server's `isValidProduct`, and a 400 gets its
  own message telling the user to remove and re-add recent items.
- **Medium:**
  - `isPersistable` now also treats a `label_` id as a typed label, as the server's
    `isShareable` does.
  - Handlers changed the list from the render-time copy, so two quick actions could lose one.
    They now use `updateCurrentUse`, which works on the latest list.
  - If saving failed, another tab's `storage` event could replace the in-memory list. It is now
    ignored while saving is failing.
- **Low:**
  - `isStale` now clamps to the month's last day (Nov 30 + 3 months = Feb 28, not Mar 2).
  - the result card's stale note says 「調べた時点で」;
  - the check sends only the in-use list;
  - the chat banner shows three names and 「ほかn点」;
  - the mobile menu button has a label that mentions stale items;
  - the disabled check button says 「2点以上追加すると調べられます」.

Declined:
- **Low: refresh staleness on a timer for a tab left open.** It needs an interval effect, and
  the check runs on every render and every visit, so an item crossing the line while the tab
  sits open is shown at the next interaction.
