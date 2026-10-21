# Responsive design: fix the broken tray footer and check every screen

Started 2026-10-21 from a phone screenshot of production (Android, about 390 CSS px wide)
taken after searching 「無印良品」.

## The bug in the screenshot

The footer of the search candidate tray (`src/components/search/LiveSearchCandidateTray.tsx`)
looks broken in two ways.

### 1. The PR note looks like it covers the last card

**What happens:** the card list is a scroll box (`max-h-[min(420px,50dvh)] overflow-y-auto`,
line 207). Its bottom edge cuts the second card's 「成分を詳しくチェック」 button in half, and the PR
note (line 303) starts right under that cut: no border, no top padding, no sign that the list
scrolls. The cut-off button and the note read as one overlapping block.

**Cause:** the footer has no separation from the scroll area, and nothing shows that more cards
are below.

### 2. The two credits are staggered

**What happens:** 「Supported by Rakuten Developers」 sits on the left. 「Webサービス by Yahoo!
JAPAN」 sits about 10px lower and indented, so it looks misplaced.

**Cause:** the credits are in a flex row (`flex flex-wrap gap-x-3`, line 309). Yahoo's snippet is
`<span style="margin:15px 15px 15px 15px">`. Inside a flex container the span becomes a flex item,
so all four 15px margins apply: it is pushed down 15px and right 15px. In normal inline text,
the vertical margins would do nothing.

**Constraint:** Yahoo's attribution rules (https://developer.yahoo.co.jp/attribution/) forbid
changing the snippet's HTML, including its color and size through CSS. We may only change what
is *around* it. The same snippet, in the same flex row, is copied in three places:
`LiveSearchCandidateTray.tsx:309`, `ProductSuggestionCard.tsx:236` and `PriceResultCard.tsx`
(around line 118). All three have this bug.

### Fix

1. **One credits component.** Add `src/components/ui/ApiCredits.tsx`, which renders both
   snippets exactly as published, and use it in all three places. Inside it:
   - Put each credit on its own line, centered (`flex flex-col items-center` around a plain
     `<div>` per credit, so the Yahoo `<span>` stays inline inside a normal block). Centered lines
     make the snippet's left and right margins symmetric, so nothing looks indented, and its
     vertical margins no longer apply.
   - Don't set a color or size on the snippet's link. The container's `text-ink-muted` is
     inherited by the `<a>`, and Yahoo forbids changing the credit's color, so check whether the
     global link style overrides it. If not, the snippet should get the browser's default link
     color (or our default link color, which is not "changing" it). Note the result in the
     component's comment.
   - Keep the snippet comments (`Begin … / End …`) so a later edit can find them.
2. **Separate the tray footer from the list.** Wrap the PR note and the credits in one footer:
   `border-t border-sand-200 px-4 pt-2 pb-2 space-y-1`.
3. **Show that the list scrolls.** Add a bottom fade inside the scroll box: a sticky
   `pointer-events-none h-6 -mt-6 bg-gradient-to-t from-white` element after the grid. Hide it
   when scrolled to the end, using one `onScroll` state flag; it's harmless if it stays, so this
   part is optional.
4. **Test:** in `tests/test_suite.ts`, read the three files and assert they use `<ApiCredits`
   and contain no `style={{`. Also assert that `ApiCredits.tsx` contains Yahoo's snippet
   text exactly as published, so it isn't edited by accident.

---

## Making the whole site responsive

The tray bug got through because nothing checks layouts at phone width. Many screens only show
up after a paid API call: search results, analysis cards, prices. The plan has three parts: a
page that shows every screen without API calls, an automatic check that runs on it, and a fix
list for the risks a code sweep already found.

### Target sizes

| Name | Size (CSS px) | Why |
|---|---|---|
| Small phone | 320 × 568 | WCAG 1.4.10 reflow width; iPhone SE 1st gen |
| Android | 360 × 800 | Most common Android width |
| iPhone | 390 × 844 | The screenshot's width |
| Phone landscape | 844 × 390 | Short height: dialogs, tray, scanner |
| Tablet | 768 × 1024 | Below the `lg` sidebar breakpoint |
| Desktop | 1280 × 800 | Sidebar layout |
| Text zoom | 390 wide, 200% text | WCAG 1.4.4: browser font size at 200% |

### Part A: a screen gallery for development

Add `src/app/dev/gallery/page.tsx`, which returns `notFound()` when
`process.env.NODE_ENV === 'production'`. It renders every component with fixture data and no
network calls:

- `LiveSearchCandidateTray`: shop products (Rakuten and Yahoo, with PR), database products with
  all badges, a long query, brand chips, and 1, 2 and 9 cards.
- `ProductSuggestionCard`, `IngredientAnalysisCard`, `DifferentialResultCard`,
  `CurrentUseResultCard`, `PriceResultCard`, `AmazonAlternativeCard`, `MedicalNotice`,
  `PairFindingList`.
- `RoutineSidebar` with empty lists, full lists (long product names) and stale entries.
- Dialogs: `ConsentDialog`, `LabelInputModal`, `RoutineExportDialog`, `RoutineImportDialog`,
  and `BarcodeScannerModal` without starting the camera (needs a `previewOnly` prop or a
  fixture state).
- Long-text cases: a 60-character product name with no spaces (Latin and Japanese), a brand
  with a very long name, prices with 7 digits, 15 ingredients in a row.

Put the fixtures in `src/lib/dev/gallery-fixtures.ts`, built from the shapes in `src/lib/types.ts`,
so a change to a type breaks the gallery at typecheck time instead of silently.

### Part B: an automatic layout check

Add `scripts/check-responsive.mjs` with a `pnpm check:responsive` script. For `/dev/gallery`,
`/terms` and `/privacy` (and `/` with consent set), at every target size, it checks:

1. **No sideways scroll:** `document.documentElement.scrollWidth <= innerWidth`.
2. **No overflowing boxes:** for each element, `scrollWidth > clientWidth + 1`, unless it
   has `truncate`, `line-clamp-*` or `overflow-x-auto` (deliberate).
3. **No overlapping text:** text boxes that intersect but are neither ancestor nor descendant
   of each other, ignoring `sr-only`, `aria-hidden` and fixed overlays.
4. **Touch targets:** buttons and links outside a sentence are at least 44 × 44.
5. A screenshot per screen and size in `scratch/responsive/`, so a person can look over them.

Each failure prints the screen, the size and a CSS selector. The script exits non-zero on any
failure.

**Browser (checked 2026-10-21):** Playwright is installed globally through `@playwright/cli`
0.1.22 (`/opt/homebrew/bin/playwright-cli`). It bundles `playwright` 1.64.0-alpha.

- `playwright-cli` works for checking by hand: `open`, `resize 390 844`, `eval`, `screenshot`.
- A Node script can load the library from the global install:
  `createRequire('/opt/homebrew/lib/node_modules/@playwright/cli/')('playwright')`. Mobile
  emulation (`isMobile`, `hasTouch`, the `devices` presets) works.
- Launch with `chromium.launch({ channel: 'chrome' })`, which uses the installed Google Chrome.
  The bundled browsers in `~/Library/Caches/ms-playwright` are older builds (chromium 1208,
  webkit 2248) than this Playwright wants (1247, 2368). A plain `chromium.launch()` fails, and
  WebKit (Safari) can't run until `playwright install` is run for this version.

**Update (same day):** after `npx playwright install`, the cache holds chromium 1248, webkit 2370
and firefox 1555. Those match `playwright` **1.64.1** (the copy in the npx cache), not the
CLI's bundled alpha. With 1.64.1, Chromium (156) and WebKit (Safari 27.2) launch and emulate an
iPhone 13 at 390px. Firefox fails to start, which doesn't matter for this site. The npx cache
can be cleared at any time, so pinning `playwright@1.64.1` as a dev dependency is the stable way
to load it. The global-path approach below is the fallback.

So the script needs no new dependency in `package.json`. It finds Playwright through the
`PLAYWRIGHT_DIR` env var, defaulting to the global path above, and fails with a clear message
if it's missing. Run it before `pnpm deploy`. Adding `playwright` as a dev dependency later
would make it work on other machines and in CI.

### Part C: risks the code sweep already found

From a search of `src/` for fixed sizes, inline styles, dense grids, `nowrap`, `truncate` and
viewport units. Each item needs checking in the gallery, then fixing if it breaks.

| # | Where | Risk | Planned fix |
|---|---|---|---|
| C1 | Tray, ProductSuggestionCard, PriceResultCard | Credits and footer (above) | `ApiCredits`, footer border |
| C2 | `LiveSearchCandidateTray.tsx:207` `max-h-[min(420px,50dvh)]` | With the phone keyboard open, the tray, header, chips and footer can fill the screen above the input. `dvh` follows the keyboard only if the viewport allows it. | Set `interactiveWidget: 'resizes-content'` in `viewport` (`src/app/layout.tsx:14`), then check that the tray shrinks with the keyboard. If it doesn't, also cap the tray itself (`max-h-[60dvh]` with the list as the only scrolling part). |
| C3 | `LiveSearchCandidateTray.tsx:157` tray title | A long query (「…」に関連するコスメ候補) wraps under the close button and pushes the list down | `break-words` and `line-clamp-2` on the `h2` |
| C4 | `LiveSearchCandidateTray.tsx:264`, `ProductSuggestionCard.tsx:196` `grid-cols-3` | Three routine buttons at 320px with 200% text: labels like 普段使えている wrap to 3 lines or overflow | At `max-[359px]` (or with text zoom), switch to `grid-cols-1`. Check in the gallery at 320 and with 200% text. |
| C5 | `IngredientAnalysisCard.tsx` (an `absolute` element, `sm:grid-cols-3`) | The absolute element may cover text when the card is narrow | Check in the gallery. If it overlaps, put it in the normal flow on small screens. |
| C6 | `design.ts:78` badges `whitespace-nowrap` | Rows with several badges (医薬部外品, 無香料 and the country) can overflow a narrow card | Let the badge row wrap (`flex-wrap`); keep `nowrap` on each badge. |
| C7 | `PriceResultCard.tsx` and `ProductSourceLink.tsx` `truncate` | Shop names or prices cut off with no way to read them | Prices must never truncate. Shop names get `line-clamp-2` and a `title`. |
| C8 | `ChatContainer.tsx:1263` message bubbles `max-w-[88%]` | Long URLs or Latin product names without spaces in replies push the bubble wider than the screen | Add `[overflow-wrap:anywhere]` to the bubble text. |
| C9 | Tray `hidden sm:inline` hint | On phones the 「タップして成分解析やリスト追加が可能です」 hint is hidden | Fine as is: the buttons carry their own labels. No change. |
| C10 | `ModalDialog.tsx:64` `max-h-[92dvh]` sheet | Phone landscape (390px tall): check that the dialog body scrolls and that the buttons stay reachable | Check in the gallery. Keep the action row outside the scrolling body if it's cut off. |
| C11 | `BarcodeScannerModal.tsx` (8 `absolute`, 1 `sticky`) | Landscape: the camera frame and the overlay text may cover the controls | Check in landscape. Use `object-contain` and a column layout under `max-h-[480px]`. |
| C12 | `LegalPage.tsx:60` table `min-w-[880px]` | Scrolls sideways inside its wrapper (correct), but nothing shows it can scroll | Add a right-edge fade or a 「横にスクロールできます」 note above the table on small screens. |
| C13 | `ChatContainer.tsx` phone status bar | With 2–3 digit counts at 320px, the counts truncate next to the 「マイルーティン」 button | Check at 320. If it's cut, shorten to 「肌荒れ 3 / 普段 2 / 使用中 1」. |
| C14 | `RoutineSidebar.tsx` drawer at 320 | Product rows with long names, the stale-entry button, the checklist | Check in the gallery with long names. |
| C15 | Fixed header (`h-14`) at 200% text | The title and three icon buttons may not fit; the title truncates (OK) but the buttons must stay 48px | Check at 200% text. |

### Part D: keep it from coming back

- Add a rule to `AGENTS.md` (project notes, not the generated Next.js block): new screens go
  into `/dev/gallery` with fixtures, and `pnpm check:responsive` runs before deploying.
- A test in `test_suite.ts` that fails when `style={{` appears outside `ApiCredits.tsx`. Inline
  styles were the source of this bug.

## Order

1. Fix the tray footer and the credits (`ApiCredits`, footer border, scroll fade). This is
   the visible bug, it's small, and it has no dependencies. Ship it on its own.
2. Build the gallery (Part A).
3. Decide on the browser tool, then add the check script (Part B).
4. Run it, then fix C2–C15 in order of what fails, with a screenshot before and after.
5. Add the rules in Part D.

## Status

- 2026-10-21: step 1 done. `ApiCredits` is used in all three places, the tray footer has a
  divider, and the scroll fade shows that the list scrolls. The credits now use the normal ink
  color at `text-sm`, not muted `text-xs`, because Yahoo forbids changing the credit's color.
  `lang="en"` moved from Rakuten's `<a>` to its wrapper, so the snippet stays as published.
  Test 113 guards all of this. A Playwright check with the search API mocked (Safari engine
  on iPhone 13, Chrome at 412, 320 and 1280) found no sideways scroll, no overlap, the credits
  centered on one axis, and the fade at the edge, disappearing at the end of the list.
  `playwright@1.64.1` is now a dev dependency.

- 2026-10-21: steps 2 and 3 done. `/dev/gallery` (dev only, 404 in production) shows 19
  screens with sample data from `src/lib/dev/gallery-fixtures.ts`. The analysis cards use real
  analyzer output. `pnpm check:responsive` (`scripts/check-responsive.mjs`) checks those
  screens plus `/`, `/terms` and `/privacy` at all 7 sizes in about 35 seconds. It needs
  `pnpm dev` running. Results and screenshots go to `responsive-report/` (gitignored).
  - The checker ignores overflow up to 8px (negative-margin close buttons), text hidden by
    `line-clamp`/`overflow: hidden`, and checkboxes inside a label (the label is the target).
    `[data-allow-small-target]` marks targets that can't be enlarged; only the API credit
    snippets use it.
  - Part D: `AGENTS.md` is generated by `next dev` and gitignored, so the "add new screens to
    the gallery" rule should go in `README.md` instead.

### First full run: what step 4 has to fix

154 screen × size combinations. 64 have problems after the review fixes to the checker: it now
scans the whole page, checks vertical clipping, treats HTTP errors as failures and tightens the
inline-link exemption. Grouped by cause:

| # | Cause | Where | Sizes |
|---|---|---|---|
| F1 | Long text with no spaces (English names, brands, URLs) doesn't wrap | Chat bubble text (C8), tray title (C3), suggestion and analysis card brand lines, differential 「含まれる肌荒れ製品」, brand chips | all phone sizes, and every size for the URL and the tray title |
| F2 | Badge rows wider than the card (C6) | Suggestion card country and 医薬部外品 badges, tray card badges, Amazon card 「原因候補の成分を含まない」 | 320, 200% text |
| F3 | Price card: the product name (`truncate`) overlaps 「楽天市場で見る」 (C7) | `PriceResultCard` | landscape, tablet, desktop |
| F4 | Scanner: the sample product names overlap the country badge | `BarcodeScannerModal` | tablet, desktop |
| F5 | Standalone reference links 17–37px tall (not in a sentence, so the inline exemption doesn't apply) | `IngredientAnalysisCard` (日本化粧品工業会), source lists in `PairFindingList`, `DifferentialResultCard` and `CurrentUseResultCard` (European Commission, RETIN-A) | iPhone, landscape, tablet, desktop |
| F6 | 200% text: fixed-width boxes overflow (prices, differential rows, dialog headers, `/terms` and `/privacy` h1). The three routine buttons shrink to 33px wide (C4). Headings overlap their subtitles (sidebar, scanner) | many | 200% text only |

Order for step 4: F1 and F2 first (they cause the sideways scroll at phone sizes), then F3–F5,
then F6.

### Step 4 result (2026-10-21)

`pnpm check:responsive` passes at all 154 screen × size combinations. `--self-test` confirms
that the checker still finds each kind of problem.

- **F1:** `body { overflow-wrap: anywhere }` in `globals.css`, instead of patching each element.
  Long English names and URLs wrap everywhere, and flex items can shrink below a long word.
- **F2:** badges have `max-w-full`, not `whitespace-nowrap`, so they wrap only when wider than
  the card. The country and badge rows have `flex-wrap`.
- **C4 (found while fixing F2):** the three routine buttons broke mid-word at 320px
  (「肌荒れし／た」). Now:
  - They stack as full-width rows when their card is narrower than 16rem. This is a container
    query (`routineActionGrid`, with `@container` on the card's actions).
  - Labels break only at `<wbr />` points (`肌荒れ<wbr />した`).
  - Buttons get `break-keep text-balance`. `text-balance` alone split words badly
    (「肌荒／れした」).
- **F3 and F4 were not real.** The checker compared the full width of `truncate` text,
  including the cut-off part, and the full glyph boxes of tightly spaced lines. The checker now
  clips text to the boxes that cut it off and trims 15% top and bottom. Screenshots confirmed
  nothing overlapped.
- **F5 was not real either.** Those links follow a label in a line of small text (「出典: …」),
  which WCAG 2.5.8 counts as inline. The inline rule now looks at the whole line (the nearest
  block, at least 2 other characters) instead of the link's direct siblings.
- **F6:**
  - `flex-wrap` or `min-w-0` on the differential row, the shop link, the price header and the
    Amazon header.
  - Compact padding on the Amazon card button.
  - The scanner frame is capped at 85% of the camera box.
  - The overflow allowance is 0.5rem, so the rem-based `-mr-2` close buttons pass at 200% text.
- **A checker blind spot the self-test caught:** text covered by other text was treated as
  hidden, so text-on-text overlap was never reported. The checker now treats it as an overlap
  when the covering element has its own text. Text behind an open modal is skipped.
- **Part D:** `README.md` has a "Responsive check" section. Test 114 fails if a component under
  `src/components` isn't in the gallery (helpers and nested parts are listed with reasons). In a
  production build `/dev/gallery` is prerendered as a 404; `next start` returns 404 for it.

After the code review of step 4:
- **The checker had blind spots, now covered by self-test cases:**
  - A link next to a heading in another block counted as inline. Only text in the link's own
    inline flow counts now.
  - Vertical clipping allowed 8–16px. It now allows 2px.
  - An icon or image over text was never reported. It is now.
  - A 15% trim hid 4px collisions between 12px lines. It's replaced by "more than a quarter of
    the shorter line's height".
  - The self-test also checks the cases that must not be reported (a tightly spaced heading
    over a line, `truncate`, a link in a sentence, a checkbox in a label).
- **Labels that can wrap** have `<wbr />` phrase breaks (the dialogs' two-column buttons, the
  Amazon button, the sidebar save button). The `buttonBase` comment now says unmarked labels
  break between characters when they don't fit.
- **`cardActionsBox`** holds `@container`, so the routine buttons' container query can't lose
  its parent.
- **Declined: keeping prices whole.** With `whitespace-nowrap`, a 4-digit price overflowed its
  72px box at 200% text. The nested rem padding doubles, so no price fits there. At normal sizes
  every price box is wide enough, so a price never splits. Splitting at 200% beats overflowing.
  The note is in `globals.css`.

Not done:
- **C2 (the phone keyboard and `interactiveWidget`):** it needs a real phone; the checker can't
  open a keyboard.
- **C12 (scroll hint on the `/terms` table):** the table scrolls inside its wrapper as intended,
  and the checker doesn't flag it.
- **C13 (status bar at 320 with a 肌荒れ product):** the gallery doesn't render `ChatContainer`
  with products. A home-page state for that is a follow-up.

## Notes

- The screenshot is from production, which still runs the version before the home-screen
  changes in `docs/plans/home-design-critique.md` (it shows 「カルテを開く」). Those changes are
  not deployed yet. The gallery and the check should run on the new version.
- Check the Rakuten credit rules as well before changing anything around it. Their snippet is
  also kept as published.
