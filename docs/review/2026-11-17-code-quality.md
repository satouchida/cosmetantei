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

## Outcome

(filled in when the work lands)
