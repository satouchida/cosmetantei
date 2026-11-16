# Code quality review, second pass (2026-11-17)

Scope: all of `src/`, `worker.ts`, `scripts/` and `tests/`. Standard: the three hard rules (one
responsibility per file, readable by a junior engineer, one rhythm per kind of work), plus dead
code. The first pass is [2026-11-10-code-quality.md](2026-11-10-code-quality.md); this one looks
at what it left.

How it was done:

- **Dead code:** every `export` in `src/` searched across `src/`, `tests/`, `scripts/` and
  `worker.ts` (calibrated on `dispatchQuickReply`, a known-used symbol), and
  `tsc --noUnusedLocals --noUnusedParameters`.
- **Complexity:** length, branch count and nesting depth of every function, measured with the
  TypeScript parser; top-level outline of every file over 300 lines.
- **Other:** `pnpm audit --prod`, a search for `any`, casts, `@ts-ignore`, `eslint-disable`,
  TODOs and stray logging.

Severity: no prefix means **Required** (a hard-rule break); **Optional** is worth doing;
**Deferred** has a stated reason.

## Clean

- No export is unreferenced except `COSMETIC_STANDARD_AMENDED` (kept on purpose, first pass D4).
- No unused locals or parameters. No `any`, one justified cast, two `@ts-ignore` on generated
  files in `worker.ts`, no TODOs. `pnpm audit --prod`: no known vulnerabilities.
- Lint and types are clean; 162 tests pass.

## Findings

| # | Finding | Evidence | Package |
|---|---|---|---|
| Q1 | `src/lib/server/cloudflare.ts` has five jobs | 419 lines: bindings, Workers AI, web search, the cache (KV and memory), rate limiting and client IP | F (wave 2) |
| Q2 | `src/lib/analyzer/ingredient-analyzer.ts` has four jobs | 829 lines: name matching, the alternatives gate, product rating, differential analysis. `performDifferentialAnalysis` is 164 lines, nesting 3 | A |
| Q3 | `src/lib/services/live-cosmetics-service.ts` has four jobs | 628 lines: query classification, product filtering, the Open Beauty Facts search, the live search. `searchCosmeticsLiveWithCloseMatches` is 114 lines, 43 branches, nesting 5 | B |
| Q4 | `src/lib/services/web-research.ts` has four jobs | 857 lines: injection and size limits, search query and page picking, page reading, caching and orchestration | C |
| Q5 | Two dialogs hold their whole device logic in the component | `BarcodeScannerModal` is one 378-line function (camera lifecycle, QR from a file, manual entry, markup); `LabelInputModal` is 249 lines, 38 branches | D |
| Q6 | Three component files hold several components | `RoutineSidebar.tsx` (457 lines, 7 components), `LiveSearchCandidateTray.tsx` (357, 3), `IngredientAnalysisCard.tsx` (one 356-line function, 49 branches) | E |
| Q7 | Small leftovers | A stale comment at `src/lib/utils/ingredient-name.ts:3`; an `exhaustive-deps` disable with no reason at `BarcodeScannerModal.tsx:192` | A, D |

Deferred:

- **`tests/test_suite.ts` is 10,063 lines.** It should be split by area, but every package
  below edits it (source-text tests name files), so splitting it now would collide with all of
  them. Do it as its own change afterwards.
- **`generateIngredientExplanation`** (`ingredient-rules.ts`, 527 lines, 139 branches) is an
  ordered rule chain: the order is the logic. Turning it into a table is a behavior risk that
  needs its own comparison run; not part of a cleanup.
- **`gemini-client.ts`** (609 lines: config, the call, decisions, cost) and `shop-apis.ts`,
  `shop-ingredients.ts` (about 460 each) are over the size cue but each reads as one job with
  helpers. Optional; not handed off.
- **`useChatRequests`** (339 lines) and `ChatContainer` (337) were sized deliberately on
  2026-11-13 ([chat-container-split.md](../plans/chat-container-split.md)).
- About 160 exports are used only in their own file or by tests (first pass D4, unchanged).

## Plan

Every package is a move with no behavior change. Rules for every worker:

- Move code as it is. A function that is split up keeps its statements in the same order.
- No new abstraction, no renamed public function, no changed message or log line.
- Importers are updated to the new path; no re-export is left behind in the old file.
- Tests: change only what names a moved file or symbol (paths in source-text tests, import
  paths, the `notScreens` list of test 114). No assertion is removed or loosened.
- Done means: `npx tsc --noEmit -p .`, `npx eslint src tests next.config.mjs` and `npm test`
  (162 pass) are clean, and the worker states the one fact the change is safe because of and
  how it was checked.

Wave 1 runs in parallel, each worker in its own git worktree. Their source files do not overlap.

| Package | Finding | Target shape |
|---|---|---|
| A | Q2, Q7 | `analyzer/ingredient-match.ts` (finding a known ingredient by name), `analyzer/alternative-gate.ts`, `analyzer/differential-analysis.ts` (with `performDifferentialAnalysis` split into named steps); `ingredient-analyzer.ts` keeps rating and `analyzeProduct`. Check: the analysis and differential output for every product in the database is identical before and after |
| B | Q3 | Query classification and the product filter move out of `live-cosmetics-service.ts` into their own modules; the Open Beauty Facts search moves beside the other Open Beauty Facts code; `searchCosmeticsLiveWithCloseMatches` is split into named steps with nesting 3 or less |
| C | Q4 | `web-research.ts` keeps caching and orchestration; the injection and size limits, the search query and page picking, and the page reading each get a module |
| D | Q5, Q7 | `useBarcodeScanner` (camera lifecycle and file reading) and `useLabelReader` hooks; the two dialogs keep markup and focus. The `exhaustive-deps` disable gets its reason or goes |
| E | Q6 | One component per file for the sidebar and the tray; `IngredientAnalysisCard` renders named section components |

Wave 2, after wave 1 is merged (it changes import lines across the codebase):

| Package | Finding | Target shape |
|---|---|---|
| F | Q1 | `server/cloudflare.ts` keeps bindings and request helpers; `server/workers-ai.ts`, `server/web-search.ts`, `server/cache.ts`, `server/rate-limit.ts` |

Then the main session merges, runs the three checks and the Cloudflare build, checks the app in
the browser, and runs one code-improver pass.

## Outcome (2026-11-18)

All six packages are merged into `main` (Opus 5.5 subagents; wave 1 in separate worktrees). Types,
lint, 162 tests and the Cloudflare build pass. Nothing was pushed or deployed.

| Package | Result | How "no behavior change" was checked |
|---|---|---|
| A (Q2, Q7) | `ingredient-analyzer.ts` 829 → 308 lines; `ingredient-match.ts`, `alternative-gate.ts`, `differential-analysis.ts`. `performDifferentialAnalysis` 164 → 45 lines | Byte-identical JSON for 614 products, 943 comparison groups and 395 current-use groups. The products were synthetic (built from every known ingredient name) plus the gallery fixtures, because real product data lives in production storage |
| B (Q3) | `live-cosmetics-service.ts` 628 → 254 lines; `query-check.ts`, `product-filter.ts`, `open-beauty-facts.ts`, `searched-name.ts`. `searchCosmeticsLiveWithCloseMatches` 114 lines / 43 branches / nesting 5 → 46 / 11 / 2 | Byte-identical output for 64 queries × 4 option sets in three setups, 3,460 classified strings and 629 products |
| C (Q4) | `web-research.ts` 857 → 409 lines; `research-guards.ts`, `page-search.ts`, `page-reader.ts` | All 69 top-level declarations hash-identical |
| D (Q5, Q7) | `BarcodeScannerModal.tsx` 417 → 226 and `LabelInputModal.tsx` 320 → 198; `useBarcodeScanner.ts`, `useLabelReader.ts`. The `exhaustive-deps` disable stays, with its reason | Old and new lines diffed; hook and effect order kept |
| E (Q6) | `RoutineSidebar.tsx` 457 → 129, `IngredientAnalysisCard.tsx` 401 → 164, `LiveSearchCandidateTray.tsx` 357 → 245; 21 new component files | Rendered HTML byte-identical for 25 states |
| F (Q1) | `server/cloudflare.ts` 419 → 106 lines; `cache.ts`, `rate-limit.ts`, `web-search.ts`, `workers-ai.ts` | All 38 top-level declarations hash-identical; each module-level state lives in one file |

From the review of the merged result (code-improver, one pass), fixed:

- Four compatibility re-exports that predate this work are gone
  (`search-barcode-service.ts`, `web-research.ts`, `ingredient-analyzer.ts`, `RoutineSidebar.tsx`);
  importers name the owning file (`2466e82`).
- `detectQueryIntent` and `normalizeSearchString` had no caller and were deleted, with the search
  evidence in the commit (`4e70777`).

Checked in a browser (the built-in one; the Chrome extension was not connected): the label
dialog → analysis flow end to end, and the scanner dialog, sidebar and analysis card screens.

Still open:

- **Unverified:** the camera path of the scanner (start, scan once, stop on close) and reading a
  label photo. The browser used for the check blocks the camera.
- **Found, not fixed (it is a behavior change, and it predates this work):** the camera's decode
  callback in `useBarcodeScanner.ts` keeps the `onScanSuccess` from the render that started the
  camera. The manual and sample paths use the current one. A ref that follows `onScanSuccess`
  fixes it.
- `LiveSearchCandidateTray` is still one 196-line function; only its two sub-components were in
  scope.
- The deferred items above are unchanged.
