# Code quality review: dead, complex and vulnerable code (2026-11-10)

Reviewed at commit `cc5fcc8`: 132 source files, 25,517 lines under `src/`, plus `worker.ts`,
`scripts/` and the config files. Baseline before the review: 158 of 158 tests pass, `tsc` and
`eslint src tests` are clean.

How it was done:

- **Dead code:** every `export` was searched across `src/`, `tests/`, `scripts/` and `worker.ts`
  (the search was calibrated on a known-used symbol), then each candidate was searched
  repo-wide, including docs and string forms. `tsc --noUnusedLocals` found unused locals.
- **Complexity:** function length and branch count were measured with the TypeScript parser
  for every function; the worst were then read.
- **Vulnerable code:** `pnpm audit --prod`, a search for unsafe HTML sinks, `eval`, every
  `fetch`, the security headers, and the validation of data that reaches links. Two security
  scans and a triage ran earlier in this project (`VULN-FINDINGS.md`, `TRIAGE.md`); their 13
  findings are fixed or were ruled out, so this pass looked for what they did not cover.

Severity labels: **Critical** blocks; no prefix means **Required**; **Optional** is worth doing;
**Nit** may be ignored.

## Summary

| # | Finding | Kind | Severity | Fixed by |
|---|---|---|---|---|
| V1 | Next.js 16.3.8 has 2 critical and 1 high advisory | Vulnerable | **Critical** | Package A |
| V2 | Product link fields are not validated on input | Vulnerable | Optional (hardening) | Package C |
| V3 | Two copies of the secret comparison and three of base64url | Vulnerable / duplicate | Required | Package C |
| V4 | No `script-src` in the Content-Security-Policy | Vulnerable | Optional, deferred | — |
| D1 | Three exported functions nothing calls | Dead | Required | Package B |
| D2 | Two unused dependencies | Dead | Required | Package A |
| D3 | Six unused `React` imports | Dead | Nit | Package B |
| D4 | Test-only and documentation-only exports | Dead? | Flagged, not deleted | — |
| C1 | `generateIngredientExplanation`: 527 lines, 140 branches, in a 1,266-line file with two jobs | Complex | Required | Package D |
| C2 | Chat route `handlePost`: 407 lines, 99 branches | Complex | Required | Package E |
| C3 | `ChatContainer`: one 1,570-line component | Complex | Required | Package F |
| C4 | `IngredientAnalysisCard`: one 614-line component | Complex | Required | Package G |
| C5 | `analyzeProduct` (206 lines), `callGemini` (157), `findMatchingKnownIngredient` (94) | Complex | Optional, deferred | — |

## Vulnerable code

### V1. **Critical** — Next.js 16.3.8 is inside three advisories

`pnpm audit --prod` reports, all fixed in `next >= 16.4.1`:

- GHSA-2464-fhr4-w9xw (critical): remote code execution in the Image Optimization API with SVG files.
- GHSA-673q-mjm6-r5xr (critical): remote code execution in `use cache` functions returning typed arrays.
- GHSA-p3m5-59mp-jv5r (high): denial of service in the App Router through Server Actions.

Exposure here looks limited: the code uses no `next/image`, no `use cache` and no Server
Actions, and SVG optimization is off by default. That is read from the code, not tested, and the
`/_next/image` route still exists. Treat it as exploitable until upgraded.

**Fix:** set `next` to the latest 16.4.x patch (at least 16.4.1) and `eslint-config-next` to
match. Read `node_modules/next/dist/docs/` for upgrade notes first (AGENTS.md). Then run the
tests, `tsc`, lint and the Cloudflare build (`npx opennextjs-cloudflare build`), and re-run
`pnpm audit --prod`.

### V2. Optional — product link fields are accepted without a check

`isValidProduct` (`src/lib/product-validation.ts:25`) checks `sourceUrl` but not `shopLink.href`,
`amazonSearchUrl` or `imageUrl`. A product the server does not know is passed back to the same
browser as sent, and `ProductSuggestionCard.tsx:164` and `LiveSearchCandidateTray.tsx:112`
render `shopLink.href` as a link.

This is not exploitable by another person today: products from a shared image or QR code go
through `sanitizeProduct`, which drops these fields, and React refuses `javascript:` links. It is
the one place where data reaching an `href` is not checked at the boundary.

**Fix:** in `isValidProduct`, when present, require `shopLink.href`, `amazonSearchUrl` and
`imageUrl` to be strings of at most 2,048 characters that start with `https://`, and
`shopLink.sponsored` to be a boolean. Add test cases for a `javascript:` and an `http:` value.

### V3. The same security helpers exist in two or three copies

- Constant-time secret comparison: `matchesOwnerKey` in `src/lib/server/owner.ts:100` and
  `sameSecret` in `src/app/api/internal/seed/route.ts:23`, each with its own `sha256`.
- `hmacKey`: `owner.ts:35` and `src/lib/server/session.ts:79`.
- `toBase64Url` / `fromBase64Url`: `owner.ts:39`, `session.ts:63`, `src/lib/routine-share.ts:190`.

Copies of a comparison that must stay constant-time drift apart: a later fix to one is easily
missed in the other.

**Fix:**

- New `src/lib/utils/base64url.ts` (no `server-only`; the browser uses it through
  `routine-share.ts`): `toBase64Url`, `fromBase64Url`.
- New `src/lib/server/signing.ts` (`server-only`): `hmacKey`, `sha256`, `sameSecret`.
- `session.ts`, `owner.ts`, the seed route and `routine-share.ts` import these and lose their
  own copies. `matchesOwnerKey` becomes a call to `sameSecret`. No behavior change.

### V4. Optional, deferred — the CSP has no `script-src`

`next.config.mjs:8` sets `frame-ancestors`, `object-src`, `base-uri` and `form-action` only. The
comment explains why: Next.js writes inline scripts, so a `script-src` needs a per-request
nonce. No unsafe HTML sink exists in the code (no `dangerouslySetInnerHTML`, `innerHTML` or
`eval`), so this is a second line of defense, not an open hole.

**How to fix later:** a nonce-based `script-src` set in middleware (Next's documented
pattern), allowing Cloudflare Turnstile's script host. It changes how pages are rendered and
cached on Workers, so it needs its own plan and a browser test of Turnstile. Not handed off in
this pass.

### Checked and fine

No unsafe HTML sinks; every server `fetch` goes to a fixed host or to a URL from the trusted-site
allow-list (`site-readers.ts`); request bodies are size-limited and validated before use; the
session, owner and seed secrets are compared in constant time; logs carry no message text.

## Dead code

### D1. Three exported functions that nothing calls

Searched: every file under `src/`, `tests/`, `scripts/`, `worker.ts`, the config files and
`docs/`, for the bare name and string forms. No dynamic imports or string dispatch exist in
this codebase. Each has exactly one hit, its own definition.

| Symbol | Where | Evidence |
|---|---|---|
| `addMultipleProductsToDynamicCache` | `src/lib/data/cosmetics-db.ts:126` | Only its definition |
| `buildAmazonBarcodeUrl` | `src/lib/services/amazon-affiliate.ts:24` | Only its definition |
| `callGeminiJSON` | `src/lib/services/gemini-client.ts:453` | Only its definition |

**Fix:** delete the three functions and their doc comments. Check after each that nothing else
became unused (for example `AMAZON_AFFILIATE_TAG` is still used by `buildAmazonAffiliateUrl`).

### D2. Two dependencies that nothing imports

`clsx` and `tailwind-merge` (`package.json`) have no import anywhere. Unused packages are
extra supply-chain surface. **Fix:** remove both and update the lockfile.

`@typescript/native` (an alias for TypeScript 7) is also not referenced by any script. It may be
used by an editor or a manual command, so it is **flagged, not removed**; the owner decides.

### D3. Nit — unused `React` default imports

`src/app/page.tsx`, `src/components/ui/ApiCredits.tsx`, `src/components/routine/ChoiceDialog.tsx`,
`ExportReminderDialog.tsx`, `RoutineExportDialog.tsx`, `RoutineImportDialog.tsx`: `React` is
imported but only named hooks or types are used. **Fix:** import only what is used
(`import { useState } from 'react'`, or `import type React from 'react'` where only the type is
needed).

### D4. Flagged, not deleted

- `searchCosmetics` (`search-barcode-service.ts:54`) and `buildQoo10SearchUrl`
  (`qoo10-affiliate.ts:48`) are called only by tests. They may be kept on purpose as the tested
  form of the search and link rules. Deleting them means deleting the tests that pin that
  behavior, which is the owner's call.
- `COSMETIC_STANDARD_AMENDED` (`cosmetic-standards-jp.ts:23`) is read nowhere, but it records
  which version of the standard the data matches and is named in a plan document. Keep.
- About 170 other exports are used only inside their own file or by tests (types, constants
  such as `SESSION_COOKIE`, test reset helpers). Dropping the `export` keyword is safe but
  touches many files for little gain; not handed off.

## Complex code

### C1. `generateIngredientExplanation` — 527 lines, 140 branches

`src/lib/services/dynamic-ingredient-service.ts` is 1,266 lines and does two jobs: a pure rule
engine that names an ingredient's category from its spelling (lines 12–760: word lists and one
function with 22 `if` blocks that each return an object), and the service that caches and
asks the AI (the rest).

**Fix (one behavior-preserving move):** move the word lists and
`generateIngredientExplanation` to a new `src/lib/analyzer/ingredient-rules.ts`, a pure module
with no cache or network imports. `dynamic-ingredient-service.ts` imports it and re-exports
`generateIngredientExplanation`, so callers and tests keep working. Rule order and every
string stay exactly as they are.

Not in this pass: turning the 22 `if` blocks into a rule table. It would remove the branches,
but several rules compute their result from the name (`isLaurylSulfate` changes the level), so
it is a rewrite, not a move.

### C2. Chat route `handlePost` — 407 lines, 99 branches

`src/app/api/chat/route.ts:108` validates the request and then handles ten button actions and
six free-text intents in one function. A reader has to hold the whole function to know which
branch a request reaches.

**Fix:** keep `handlePost` as the reader's map — rate limit, parse, validate, resolve products,
then dispatch — and move each branch into a named function taking one context object
(`{ routine, selectedProduct, sentProduct, registered, userText, ... }`) and returning a
response or `null` ("not mine"). Put the handlers in `src/app/api/chat/` beside the route
(`action-handlers.ts` for button actions, `intent-handlers.ts` for free text), in the same order
as today. Order, replies, status codes and every string stay the same.

### C3. `ChatContainer` — 1,570 lines in one component

`src/components/chat/ChatContainer.tsx` owns the message list, the two product lists, import
and export, the reminder, quick replies, the search tray, the drawer and six dialogs.

**Fix:** move state and its handlers into hooks, one concern each, and leave the component to
compose them and render:

- `useRoutineLists` (`src/components/chat/useRoutineLists.ts`): `badProducts`, `usable`,
  `routine`, `registeredProducts`, stale entries, add / move / remove / clear / in-use
  handlers, the list-conflict and clear-target state.
- `useRoutineTransfer`: export, image and link import, `applyImport`, the export reminder.
- The pure helpers above the component (`appendStats`, `appendProducts`, `pickReply`, the
  quick-reply icon map, the sample products) into a helpers module.

No behavior change. Hooks must keep the existing refs (`badRef`, `reminderStateRef`) so the
fixes from the last review stay.

### C4. `IngredientAnalysisCard` — 614 lines in one component

`src/components/chat/IngredientAnalysisCard.tsx:132` holds the AI re-analysis request, the
per-ingredient "explain with AI" request, the detail panel and the card.

**Fix:** extract `useAIAnalysis(initialAnalysis)` (the request, retry and result state),
`useIngredientExplanation` (the explain request and its messages), and an
`IngredientDetailPanel` component for the selected-ingredient panel. The card keeps layout only.

### C5. Optional, deferred — three long functions

- `analyzeProduct` (`ingredient-analyzer.ts:362`, 206 lines, 71 branches): three stages run
  in one body — rate each ingredient, decide the overall level, write the summary. Split into
  `rateIngredients`, `overallRisk` and `summaryFor`.
- `callGemini` (`gemini-client.ts:222`, 157 lines, 52 branches): split into `buildRequestBody`
  and `readGeminiResponse`, keeping the budget reserve / settle in `callGemini`.
- `findMatchingKnownIngredient` (`ingredient-analyzer.ts:96`, 94 lines, 43 branches).

These read top to bottom and are well covered by tests, so they come after C1–C4. Follow-up:
this section of this document.

## Work packages for the implementing agents

The reviewer does not edit product code; each package goes to an implementing agent (Opus 5.5)
with this document as the brief, and the returned diff is held to the same rules: no behavior
change unless stated, tests / `tsc` / lint green, deletions carry their evidence.

| Package | Findings | Files |
|---|---|---|
| A | V1, D2 | `package.json`, lockfile |
| B | D1, D3 | `cosmetics-db.ts`, `amazon-affiliate.ts`, `gemini-client.ts`, six files with unused imports |
| C | V2, V3 | `session.ts`, `owner.ts`, seed route, `routine-share.ts`, `product-validation.ts`, two new modules |
| D | C1 | `dynamic-ingredient-service.ts`, new `ingredient-rules.ts` |
| E | C2 | `api/chat/route.ts`, two new handler modules |
| F | C3 | `ChatContainer.tsx`, new hooks and helpers |
| G | C4 | `IngredientAnalysisCard.tsx`, new hooks and panel |

Order: B, C and D first (small, separate files); then E, F and G; A last and alone, because
installing packages changes `node_modules` under any test run in progress.

## Outcome (2026-11-11)

All seven packages were implemented by Opus 5.5 subagents and checked by the reviewer: 159 of 159
tests, `tsc`, `eslint src tests`, `pnpm audit --prod` ("No known vulnerabilities found") and the
Cloudflare build (`npx opennextjs-cloudflare build`) pass. Nothing was deployed.

| Package | Result | How it was checked |
|---|---|---|
| A (V1, D2) | `next` is 16.4.5 (the owner bumped it and other versions outside this review); `clsx` and `tailwind-merge` removed | Audit clean; build passes |
| B (D1, D3) | Three dead functions and six unused imports removed | No reference to the three names remains in `src/` or `tests/` |
| C (V2, V3) | `src/lib/utils/base64url.ts` and `src/lib/server/signing.ts` hold the single copies; `isValidProduct` checks `shopLink`, `imageUrl`, `amazonSearchUrl`; test 159 added | Diff read; the removed copies were identical in behavior |
| D (C1) | Rules moved to `src/lib/analyzer/ingredient-rules.ts` (735 lines); the service is 543 lines | The rule function's hash is the same before and after |
| E (C2) | `handlePost` is 83 lines; handlers in `action-handlers.ts`, `intent-handlers.ts`, `shared.ts` | Dispatch order read against the old function; route tests pass unchanged |
| F (C3) | `ChatContainer.tsx` 1,812 → 1,368 lines; `useRoutineLists`, `useRoutineTransfer`, `chat-helpers` | Browser: sample load, in-use switch, clear dialog and focus, export dialog |
| G (C4) | `IngredientAnalysisCard.tsx` 745 → 396 lines; `useAIAnalysis`, `useIngredientExplanation`, `IngredientDetailPanel` | Browser: detail panel opens, focus moves to its title, no console errors |

Behavior changes (all deliberate, all small):

- **V2:** a product whose `shopLink.href`, `imageUrl` or `amazonSearchUrl` is not `https://` is now
  rejected. `amazonSearchUrl` may be up to 4,096 characters, because the server's own link for a
  200-character Japanese name reaches about 3,650. A saved product with such a field would be
  dropped when the saved list is read; every value the server produces is https, so none is expected.
- **E:** an unexpected error thrown during a price lookup is now caught by the route's own
  `catch` and answered with the standard "error, please retry" reply (HTTP 500 JSON). Before, the
  un-awaited call let it escape as a bare server error.
- **F:** the hashchange effect now runs just before the drawer key effect instead of just after
  (they share no state), and the sample products are module constants instead of new objects per
  click (nothing mutates a product).

Still open:

- **V4** (CSP `script-src`): planned in [docs/plans/content-security-policy.md](../plans/content-security-policy.md), not started.
- **C5** was done on 2026-11-11 (packages H and I, Opus 5.5 subagents), with no behavior change:
  - `analyzeProduct` 206 → 55 lines (`rateIngredients`, `labelNotesFor`, `overallRiskOf`,
    `summaryFor`); `findMatchingKnownIngredient` 94 → 40 lines (`exactMatch`, `containsKnownName`
    and two smaller helpers; the ordered rule steps stay inline because their order is the
    logic). Output compared before and after for 8,173 names and 304 products: identical.
  - `callGemini` 157 → 73 lines (`buildRequestBody`, `gatewayHeaders`, `readGeminiResponse`). The
    reserve → fetch → read → record usage → settle order is unchanged. 47 scenarios compared
    before and after (return values, log lines, budget settles, usage events, request bodies):
    identical. Not compared: the timeout value passed to `AbortSignal.timeout`, a line that was
    not touched.
- **D4**: the owner's decision on the two test-only functions and on `@typescript/native`.
- **F left the larger half**: `ChatContainer` is still about 1,280 lines in one component
  (the chat requests, quick replies, the tray and the JSX). Planned in
  [docs/plans/chat-container-split.md](../plans/chat-container-split.md), not started.
- **D4, examined 2026-11-11:** `buildQoo10SearchUrl` is the plain Qoo10 search address; the cards
  use `buildQoo10AffiliateUrl`, which builds the same search separately. Fix: have the affiliate
  builder wrap the plain one (identical output, one copy of the rule). `searchCosmetics` is the
  September in-memory search; nothing in the app has called it since 2026-10-08 (all search goes
  through `searchCosmeticsLive`), and it lacks the brand spellings, name aliases and ヴ fold, so
  its tests check rules users never hit. Fix: delete it and move its tests' checks to the real
  search.
- **D4 fixed 2026-11-11 (packages J and K):**
  - `buildQoo10AffiliateUrl` now wraps `buildQoo10SearchUrl`; `QOO10_MYLINK_SEARCH` is composed
    from the same two pieces. 594 brand and name combinations compared before and after:
    identical links.
  - `searchCosmetics` is deleted. Tests 2, 7 and 8 run the same assertions through
    `searchCosmeticsLive`. Tests 15 and 16 had been checking zero products (their generic
    queries return nothing from the real search; test 15 already did before this change). They
    now add real products the queries match and fake ones the search must not return
    (a placeholder brand, a query word as the brand, a fabricated template name), and assert
    that at least one result was checked. Measured: 4 products checked in each.
  - **Finding from that work, fixed 2026-11-12 (package L):** a cached product whose brand was
    the single word 炭 was returned by the search and shown with 炭 as its brand
    (`GENERIC_VOCABULARY` in `src/lib/services/brand-check.ts` had 炭酸泡 and 炭酸洗顔 but not 炭).
    `brand-check.ts` now has a whole-word list (炭, 泥, 塩, 泡, 炭酸, クレイ, スクラブ, 酵素): a brand is
    generic when every word of it is vocabulary or exactly one of these. Whole words only, so a
    name that merely contains the character (米肌, 牛乳石鹸, 草花木果) is unaffected. Checked on 443
    real brand strings from `brands-jp.ts` and `seed-products.ts`: no verdict changed. Tests 16
    and 30 cover it and fail without the fix. Not tested: whether the AI brand check at intake
    would have stopped such a product anyway.
    Owner's decision (2026-11-12): 米, 酒, 茶, 蜜, 油, 水, 美白, オイル, ジェル, メンズ, プチプラ, 無添加,
    オーガニック, 石鹸 (also 石けん, せっけん) and シャンプー are generic on their own and were added to the
    whole-word list; TSUBAKI (ツバキ, つばき) is a real brand and was added to `brands-jp.ts`. 446 real
    brand strings compared again: no verdict changed.
    Owner's second decision (2026-11-12): 灰, 土, 粉, 石, 砂, 麹, 糠 (also ぬか), 絹, 花, 葉, 竹, 海, ゲル,
    ピーリング, ゴマージュ, はちみつ (also ハチミツ), ホホバ, ヒアルロン酸 and コラーゲン are generic on their own,
    and a name made only of generic words is generic too ("combination of generic terms are
    generic"). Each separator-split word is now generic when it splits entirely into whole-list
    words, so 炭泥, はちみつ石鹸, 竹炭石鹸, 米ぬか and ホホバオイル are generic, while 花王, 雪肌精, 草花木果,
    茶のしずく and 石澤研究所 are not (some part is not a listed word). 446 real brand strings compared
    again: no verdict changed. Review fix: vocabulary inside a word now splits the word instead of
    being deleted, so the two sides no longer join (石ミルク鹸 had read as 石鹸); 石ケン and セッケン
    were added. ボディソープ is a product category (owner, 2026-11-12) and was added too; every
    candidate word is now generic.
- Test assertions that read source text now read the split files joined together
  (`CHAT_ROUTE_FILES`, `CHAT_CONTAINER_FILES`); no assertion was removed or loosened.
- One stale comment remains: `src/lib/utils/ingredient-name.ts:3` still says the rule
  explanations live in `dynamic-ingredient-service`.
