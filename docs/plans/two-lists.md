# Two lists: 肌荒れしたコスメ and 使えているコスメ

Drafted 2026-11-08, decisions 2026-11-09. Status: implemented 2026-11-09 ([walkthrough](../walkthroughs/2026-11-09-two-lists.md)).

## Why

Registering a product today means choosing between three lists: 肌荒れした, 普段使えている and
今使っている. The owner found 普段使えている and 今使っている hard to tell apart when registering.
For most people the two lists hold the same products, so the same product is often added twice.

| | 普段使えているコスメ (`safeProducts`) | 今使っているコスメ (`currentlyUsing`) |
|---|---|---|
| Used for | The comparison: its ingredients are removed from the culprit candidates | The combination check (`pair-rules.ts`, context `current`) |
| Saved | Only while the page is open | In this browser (`cosmetantei:current-use:v1`), with the date each item was added |
| Old products | Allowed | Asked to confirm after 3 months (`isStale`) |

The owner's decision (2026-11-08): keep two categories, **肌荒れしたコスメ** and
**使えているコスメ**. 今使っているコスメ goes away as a separate list.

## The new model

- **肌荒れしたコスメ**: unchanged. Used as the bad side of the comparison.
- **使えているコスメ**: one list that replaces 普段使えている and 今使っている. Each item keeps the
  date it was added and an `inUse` flag (default `true`).
  - **The comparison** uses every item, including items no longer in use: a product that was fine
    in the past is still evidence.
  - **The combination check** uses only the items with `inUse: true`.
  - **The 3-month check** keeps its timing. It now offers two answers: 「今も使っている」 resets
    the date, and 「もう使っていない」 sets `inUse: false`. The item stays in the list, shown as
    「以前使っていた」, and drops out of the combination check. Deleting still removes it.
  - A small toggle on each item switches `inUse` back and forth, so the question is never asked at
    registration time.
- **Registering** needs one choice: 「肌荒れした」 or 「使えている」. The 「今使っている」 button goes
  away from every card.

## Decisions (owner, 2026-11-09)

1. **使えているコスメ is saved in this browser**, as 今使っているコスメ is today. Products used
   without trouble are now stored on the device, so the privacy policy changes. Draft:
   [docs/legal/privacy-policy-two-lists-draft.md](../legal/privacy-policy-two-lists-draft.md).
2. **肌荒れしたコスメ is not saved**; it is kept only while the page is open. Instead, the page
   recommends saving the lists as an image, so the user can load them next time instead of
   searching and registering again (Step 4b).
3. **Clearing names the list.** The vague 「クリア」 is replaced by two buttons:
   「肌荒れしたコスメのリストをクリア」 and 「使えているコスメのリストをクリア」. Each asks for
   confirmation (warning style, danger-colored confirm button), because neither can be undone.
4. **The sample data never touches the saved list.** Its usable products are added for this page
   only (not saved), or the sample button is shown only while 使えているコスメ is empty. The first
   is preferred; the second is the fallback if session-only items make the store too complex.
5. **A product is in one list only.** When a product already in one list is registered in the
   other, the page asks: 「肌荒れしたコスメに移す」 (or 使えているコスメに移す), 「リストから削除」,
   or cancel. The same rule applies to imports: a product in both lists of an imported image goes
   to 肌荒れ only, as `comparisonLists` does today.

## Data and wire format

### Browser storage

- New key `cosmetantei:usable:v1`: `[{ product, addedAt, inUse }]`, limit `MAX_ROUTINE_PRODUCTS`
  (20).
- Migration on first read: entries under `cosmetantei:current-use:v1` become
  `{ product, addedAt, inUse: true }` under the new key. Then delete the old key. Products from
  typed labels and seller text are still never saved (`isPersistable`).
- No session-only `safeProducts` exist after a reload, so nothing else migrates.

### Requests to the server: unchanged

`UserRoutineState` keeps `badProducts`, `safeProducts` and `currentlyUsing`. The browser fills them
from the two lists:

- `safeProducts`: every 使えているコスメ item.
- `currentlyUsing`: the items with `inUse: true`.

The server code, the validation (`server/validation.ts`, `server/client-products.ts`) and the
`/api/analyze` contract stay as they are. Only server wording changes. A rename of the fields can
come later; it is not needed for this change.

### Exported image and QR link

- **File data** (`serializeRoutine`): version 2,
  `{ bad: Product[], usable: [{ product, addedAt, inUse }] }`.
- **QR link** (`encodeShareLink`): version 2, `{ b, u }` (the `inUse` flag isn't included, to keep
  the link short; imported items start as in use).
- **Reading version 1** stays supported (images people already saved):
  - `safe` and `current` (`s` and `c` in links) merge into `usable`, with duplicates removed.
  - `current` entries keep their `addedAt` and `inUse: true`. `safe`-only entries get `addedAt` =
    now and `inUse: false`, because nothing says they are used now.
  - A product in `bad` is not added to `usable` (same rule as `comparisonLists` today).
- The image shows 「使えていたコスメ」 for the names and a count 「肌荒れしたコスメ N点」. The
  「今使っているコスメ N点」 line goes away.

## Steps

### Step 1. The usable-list store

- `src/lib/current-use.ts` → rename to `src/lib/usable-products.ts` (or keep the file and rename
  the exports). `CurrentUseEntry` gains `inUse`. New storage key, migration from the old key,
  `parse` accepts old entries without `inUse`. Keep `isStale`, `isPersistable`, `STALE_AFTER_MONTHS`.
- `src/lib/client/browser-store.ts`: comment only.
- `src/lib/product-validation.ts`, `src/lib/product-source.ts`: comments that name 今使っている.

### Step 2. ChatContainer state and handlers

`src/components/chat/ChatContainer.tsx`:

- State: `comparison` keeps only `badProducts`. 使えているコスメ comes from the store
  (`useSyncExternalStore`), like `currentUse` today. Build `routine` as described above.
- `handleAddToSafe` and `handleAddToCurrent` become one `handleAddToUsable` (toast
  「【使えているコスメ】に追加しました」, the not-saved note for typed labels, the 20-item limit).
  Apply decision 5 in both add handlers.
- `handleRemoveSafe` and `handleRemoveCurrent` become one `handleRemoveUsable`.
  `handleConfirmCurrent` stays as `handleConfirmUsable`, plus a new `handleSetInUse(id, inUse)`.
- `registeredProducts` (the alternative-card filter) uses bad + usable.
- `staleEntries`: only items with `inUse: true`, so 「もう使っていない」 items are not asked again.
- `handleCheckCurrentUse`: send only `inUse` items; the count check (2 or more) uses them too.
- `handleLoadPreset('clear')` becomes two handlers, `clearBad` and `clearUsable`, each behind a
  confirmation dialog (decision 3). `sample_irritation` per decision 4.
- `handleAddToBad` and `handleAddToUsable`: when the product is in the other list, open the
  move/remove dialog (decision 5) instead of adding.
- The `reset` quick reply (「🔄 リセットする」) clears 肌荒れ only and says so:
  「肌荒れしたコスメのリストを空にしました（使えているコスメはそのままです）」.
- `applyImport`: one usable list. In 'replace', the usable list is replaced; in 'append', items are
  added, skipping duplicates and products already in 肌荒れ.
- `handleExportImage`: the new snapshot shape.
- Header badge `aria-label` and the mobile summary line 「肌荒れ N点 / 普段 N点 / 使用中 N点」 →
  「肌荒れ N点 / 使えている N点」.
- The 3-month banner: 「使えているコスメ」に… and the 「確認する」 button target
  (`current-use-section` id).
- `add_analyzed` replies (the 'safe' branch) and their quick replies.
- The welcome message.
- Props to `ProductSuggestionCard`, `IngredientAnalysisCard`, `LiveSearchCandidateTray` and
  `RoutineSidebar`.
- `typedLabelsLost` for the import dialog.

### Step 3. Registration buttons (three → two)

- `src/components/chat/ProductSuggestionCard.tsx`: remove `onAddToCurrent` and its button; the
  safe button reads 「使えている」 (aria-label 「使えている（名前）」).
- `src/components/search/LiveSearchCandidateTray.tsx`: the same.
- `src/components/chat/IngredientAnalysisCard.tsx`: remove `onAddToCurrentRoutine`; the button reads
  「「使えているコスメ」に登録」.
- `src/components/ui/design.ts`: remove `routineAction.current`. Keep the `current` tone, which
  `CurrentUseResultCard` and the sidebar still use for in-use items; update the color note in the
  header comment.

### Step 4. The sidebar

`src/components/routine/RoutineSidebar.tsx`:

- Two sections: 肌荒れしたコスメ and 使えているコスメ (`id` for the 3-month banner link).
- Each usable item: brand and name, 「N月N日に追加」, a 「使っている／以前使っていた」 toggle,
  and the 3-month prompt with 「今も使っている」 and 「もう使っていない」.
- The empty-state text explains both uses in one line: 比べて候補を絞り込み、今使っているものは
  組み合わせもチェックできます.
- 「組み合わせをチェック」 stays in the 使えているコスメ section and counts only in-use items
  (「使っているコスメが2点以上で調べられます」).
- The header 「クリア」 button goes away. Each section gets its own clear button:
  「肌荒れしたコスメのリストをクリア」 and 「使えているコスメのリストをクリア」, shown only when that
  list has items, each opening a confirmation dialog (`ModalDialog`, danger confirm button).
- The footer checklist: 「使えているコスメ N点（任意・あると候補を絞り込めます）」.
- Props: remove `onRemoveSafe`, `onRemoveCurrent`, `onConfirmCurrent`; add the usable handlers.

### Step 4b. Recommend saving the lists as an image

肌荒れしたコスメ is lost when the page closes, and searching for the same products again costs the
user time (and the site AI budget). The page recommends 「リストを画像で保存」 at the moment the
lists are most worth keeping.

- **When:** once per page session, the first time a comparison result (differential card) is shown
  while 肌荒れしたコスメ has products and the lists changed since the last export in this session.
  Not on first visit, not on every result, never while another dialog is open.
- **What:** a dialog (`ModalDialog`, not a toast, so it isn't missed on mobile):
  - Title: 「リストを画像で保存しませんか？」
  - Text: 「肌荒れしたコスメのリストは、ページを閉じると消えます（端末にも保存しません）。画像で
    保存しておくと、次回は「保存した画像から読み込む」で、検索し直さずに続きから使えます。」
  - Buttons: 「画像で保存する」 (opens the existing export dialog) and 「あとで」.
  - A checkbox 「今後このお知らせを表示しない」.
- **Storage:** the checkbox is saved as `cosmetantei:export-reminder:v1` = `"off"` (a setting, no
  product data). The privacy draft lists it.
- **Not used:** `beforeunload`. Browsers show only a generic "leave site?" message there, which
  can't explain why, and it would appear on every reload.
- Files: a new `src/components/routine/ExportReminderDialog.tsx`; `ChatContainer.tsx` (when to
  show, export-since-change flag); `src/lib/client/browser-store.ts` for the setting; the gallery;
  test 114 (gallery) and a new test for when it shows.

### Step 5. Import and export dialogs, image

- `src/lib/routine-share.ts`: the snapshot type `{ badProducts, usable }`, version 2 write, version
  1 and 2 read, `excludedCount`, `isEmptySnapshot`.
- `src/components/routine/RoutineImportDialog.tsx`: two counts (肌荒れしたコスメ, 使えているコスメ).
- `src/components/routine/RoutineExportDialog.tsx`: the image content and the `alt` text.
- `src/lib/client/routine-image.ts`: `RoutineImageContent` (`safeProducts` → `usableProducts`,
  drop `currentCount`), the section title, the counts line.

### Step 6. Wording on the server, legal pages and docs

Server and shared text (the strings the quick-reply map matches must change together):

- `src/app/api/chat/route.ts`: `SINGLE_ANALYSIS_REPLIES` and the label-input replies
  (「✅ 使えている（リストに追加）」), the combination-check replies (「使っている N点のコスメ…」,
  the 2-item hint), the differential hints and quick replies.
- `src/components/chat/quick-replies.ts`: the keys above, `PROMPT_SAFE_PRODUCT`,
  `PICK_FROM_CARDS_HINT`, 「✅ 使えているコスメを入力する」. Keep the old keys as aliases for one
  release, so a page opened before the deploy still works.
- `src/lib/services/chat-gate.ts` (the medical reply's quick replies).
- `src/lib/services/chat-replies.ts` (the cause explanation prompt and the card hint).
- `src/lib/services/live-cosmetics-service.ts` (the help text: 「肌荒れした」または「使えている」).
- `src/lib/analyzer/ingredient-analyzer.ts`: summaries and reasons that say 普段使えている; the
  `otherRegistered` comment.
- `src/lib/analyzer/pair-rules.ts`: comment for the `current` context.
- `src/lib/services/alternatives-service.ts`: comment only (the request already excludes all
  registered products).
- `src/components/chat/DifferentialResultCard.tsx`: 「使えているコスメ (N品)」 and the empty text.
- `src/components/chat/CurrentUseResultCard.tsx`: title 「使っているコスメの組み合わせ」.
- `src/components/chat/PairFindingList.tsx`: comment.
- `src/app/layout.tsx`: the description already says 「問題なく使えている化粧品」; no change.

Legal pages (both the page and the source document):

- `src/app/privacy/page.tsx` and `docs/legal/privacy-policy.md`: apply
  [the draft](../legal/privacy-policy-two-lists-draft.md) (第2条第4号, 第8条第2項, the revision
  note and the 最終改定日).
- `src/app/terms/page.tsx` and `docs/legal/terms-of-service.md`: 「肌荒れしたコスメ」と
  「使えているコスメ」.
- Test 129 checks the legal pages; update its expected text.

Docs:

- `docs/walkthroughs/` new walkthrough for this change; `docs/walkthroughs/2026-10-14-current-use.md`
  gets a one-line pointer.
- `docs/plans/routine-image.md`: the counts line and the version 2 format.
- `docs/PROGRESS.md`: a row after the commit.

### Step 7. Gallery and fixtures

- `src/lib/dev/gallery-fixtures.ts`: the current-use fixtures become usable items, one with
  `inUse: false` and one stale.
- `src/app/dev/gallery/Gallery.tsx` and `page.tsx`: the sidebar, cards and dialogs with the new
  props.

### Step 8. Tests (`tests/test_suite.ts`)

Update:

- 76 (current-use list, combination check, 3-month check): the usable store, `inUse`, the check
  uses in-use items only, 「もう使っていない」.
- 110 (browser store): the new key and the migration from `cosmetantei:current-use:v1`.
- 103 (image data and QR link): version 2 round trip; version 1 files and links still read, with
  `safe` and `current` merged and `bad` winning.
- 141 (Yahoo! seller-text products not saved): the new store.
- 47 (quick replies), 42 and 54 (chat replies), 66 (chat route), 63 and 157 (alternatives exclude
  every usable item), 4 (differential), 96, 102, 71, 94: wording and props.
- 114 (gallery), 129 (legal text).

Add:

- Registering a product that is in the other list offers move or remove, and never leaves it in
  both (decision 5).
- Each clear button clears only its own list, after confirmation (decision 3); the sample never
  writes to the saved list (decision 4).
- The export reminder shows once per session after a comparison result, not again after export or
  「今後表示しない」.
- The differential sends every usable item as `safeProducts`; the combination check sends only
  in-use items.

## Verification

- `npm test`, `tsc`, `eslint`.
- In the browser (dev server): register from the search tray, a suggestion card and an analysis
  card; reload and check 使えているコスメ is kept and 肌荒れ follows decision 2; run the
  comparison and the combination check; mark one item 「もう使っていない」 and check it is still
  in the comparison but not in the combination check.
- Migration: put a version 1 `cosmetantei:current-use:v1` value in localStorage, reload, check the
  items appear in 使えているコスメ with their dates.
- Import an image and a QR link made before the change.
- Mobile width (375px) and desktop, light and dark; the gallery screens.

## Out of scope

- Renaming `safeProducts` and `currentlyUsing` in the API.
- Saving 肌荒れしたコスメ (decision 2).
- Any change to how the comparison or the combination rules work.
