# Plan: cut the CPU time of ingredient matching (「敏感肌向けの化粧水」 503)

Written 2026-11-24. Status: implemented 2026-11-24 (test 222), not yet deployed. See [Result](#result).
From the full live check, day 2 ([results](full-live-check-results.md), B3 and finding 2).

This is a speed change only: every lookup must give the same result as before.

## What the live check showed

- 「敏感肌向けの化粧水」 got 「サーバーで問題が起きました」. The tail had `POST /api/chat 503`, outcome
  `exceededCpu`, `Worker exceeded CPU time limit.`, cpuTime 151 ms, right after the Clef gate.
- 「🔁 もう一度送る」 failed the same way (cpuTime 10 ms, wall 12 ms).
- No gate verdict was cached in KV for this message, which fits the request being stopped before its
  `waitUntil` write.

## Root cause

**The plan's limit.** The Cloudflare account is on the Free plan ([launch-readiness.md](launch-readiness.md)),
whose CPU limit is 10 ms a request. Cloudflare lets some requests go over, which is why other chat requests used
300–860 ms and passed. A long, CPU-only stretch is the most likely to be stopped. The retry being stopped after
10 ms suggests the limit counts more than one request. I can't confirm that from the logs.

**Where the time goes.** I measured offline with the production saved-products index (126 products, read from KV
read-only), with the network blocked:

| Request | `findAlternatives` CPU |
|---|---|
| 敏感肌向けの化粧水 (toner, nothing to avoid) | 93–135 ms |
| 敏感肌向けのクリーム | 34–35 ms |

A CPU profile of `findAlternatives` (6 runs, 380 ms):

- `normalizeIngredientName` (`utils/ingredient-name.ts`): **255 ms self**, mostly its 3 regex replaces.
- It is called from:
  - `findMatchingKnownIngredient` → `exactMatch` (128 ms);
  - `containsKnownName` (60 ms);
  - `cautionCounts` (106 ms, through the same lookups).

`exactMatch` and `containsKnownName` normalize **every name and alias of every DB entry again on every lookup**.
`findSafeAlternatives` looks up every ingredient of every saved product of the kind: about 126 products × ~30
ingredients × ~50 entries × several names. The toner path is the slowest because more saved products are toners.

## Step 1. Normalize the DB names once

**Change** (`ingredient-match.ts`):

- Build the normalized names once, the same way `knownAbbreviatedNames()` already does for the abbreviated forms:
  - a `Map` from normalized name to the **first** entry in DB order that has it (`exactMatch` returns the first
    match today);
  - each entry's normalized aliases, for `containsKnownName` and its `EXACT_MATCH_ONLY` branch.
- `exactMatch` becomes one `Map` lookup. `containsKnownName` and `aliasIsPartOf` use the stored aliases.

## Step 2. Remember lookups by raw name

**Change** (`ingredient-match.ts`). `findMatchingKnownIngredient(raw)` depends only on `raw` and the DB, which doesn't
change while the Worker runs. Keep results in a `BoundedCache` (`utils/bounded-cache.ts`, already used for KV), for
example 5,000 names, keyed by the raw string. Store "not found" too.

`cautionCounts` already keeps its own per-call `Map`. That one stays.

## Step 3. Measure, and only then look further

- Re-run the offline measurement: toner request, production index snapshot, network blocked.
- The target is under 30 ms for the toner request.
- If `getOrGenerateIngredientExplanation` (164 ms inclusive in the profile) is still large after steps 1 and 2,
  its rule matching is the next step, in its own plan.

**Not changing.**
- The Workers plan. Moving to Workers Paid ($5 a month, 30 s CPU) would remove the limit. That's the owner's call
  and outside this plan.
- `normalizeIngredientName` itself (its regexes are correct; the fix is calling it less).

## Tests

Use the next free test numbers.

- **Same results:** for every ingredient name in the seeded products and the test fixtures, plus the hard cases in
  the existing tests (フェノキシエタノール, ジプロピレングリコール, 水酸化亜鉛, サリチル酸ベンジル, 小麦由来の注記), the
  new `findMatchingKnownIngredient` gives the same entry as the old code. Keep a copy of the old function in the
  test to compare against.
- **First match wins:** a name that two entries share maps to the earlier entry.
- **Cache:** the same raw name twice returns the same entry, and a miss is remembered.
- A mutation check: drop the first-match rule and the test fails.
- The full gates (`tsc`, `eslint`, `npm test`) and a live check: 「敏感肌向けの化粧水」 answers, and its `cpuTime` in
  the tail is far lower than 151 ms.

The measuring script and the index snapshot stay in the scratchpad. They are not committed (the snapshot is
production data).

## Result

Implemented as planned, plus one change step 3 called for:

- **Steps 1 and 2** in `ingredient-match.ts`: `buildKnownNames` builds the normalized names once (`knownIngredientByName` is
  the exact lookup), and `findMatchingKnownIngredient` remembers results by raw name (names over 200 characters are
  not remembered).
- **Step 3 found the same defect in `getOrGenerateIngredientExplanation`** (`dynamic-ingredient-service.ts`), not in its
  rule matching: for every name not in the DB (most names) it normalized every DB name again, in two loops. The second
  loop repeated the first loop's alias check with a length condition, so it could never return. Both loops are now
  one `knownIngredientByName` lookup.

Offline, production index snapshot, network blocked (`findAlternatives`, 4 runs; the first run includes building
the index):

| Request | Before | After |
|---|---|---|
| 敏感肌向けの化粧水 | 88–125 ms | 25 ms first, then 5–6 ms |
| 敏感肌向けのクリーム | 32–34 ms | 6 ms first, then 1–2 ms |

**Same results.** Checked offline against the old code (`git stash`): `findMatchingKnownIngredient` and
`getOrGenerateIngredientExplanation` give the same result for all 6,588 names (snapshot and seeded ingredients, every
DB name and alias with variants, and every quoted string in `tests/test_suite.ts`), and `findAlternatives` gives
byte-identical results for the three requests above. Test 222 keeps the old exact-match function as an oracle; the
abbreviation and partial-match paths are covered by the existing match tests, which pass unchanged.
