# Plan: improving the alternatives search

Written 2026-11-18. Status: Paths 0, 1 and 2 done (the owner's measurement runs are still to do); Paths 3 to 8 are plans for later.
Why these paths: [alternative-search-quality.md](alternative-search-quality.md) (the report).
Earlier work: [alternative-recommendations.md](alternative-recommendations.md).

Rules that hold for every path:

- Code decides what is shown. No model chooses or ranks a product.
- What goes to the shops is the kind's name and fixed words only. Nothing the user typed, no
  product name, no ingredient list.
- Shop text is used for the one reply and never stored (Rakuten terms, Article 10 (9)).
- A path that widens results must not weaken the badge: 「原因成分フリー」 means the avoided
  ingredients were checked against a list we could read.

## Path 0. Measure (implement first)

Goal: know, per kind, where candidates are lost.

### 0a. One log line per search

- Where: `findAlternatives()` in `src/lib/services/alternatives-service.ts` and
  `findShopAlternatives()` in `shop-alternatives.ts`. Follow the style of `[search-miss]` in
  `live-cosmetics-service.ts`: one `console.log` of a prefix and a JSON object.
- Line: `[alternatives] {...}` with counts and fixed words only:
  - `kind`, `subKind` (after Path 1; absent before), `avoid` (how many ingredients),
    `terms` (the fixed shop words used);
  - `saved` (how many the saved pool gave), `answeredBy` (`saved` / `shop` / `web` / `none`);
  - `shop`: `fetched` per shop, and `dropped` by reason: `otherKind`, `notSingle`, `excluded`,
    `noList` (no readable ingredient list and no saved product), `suspect`, `irritant`,
    `standard` (not allowed by the cosmetics standard), `unrated` (under the 80% bar),
    `duplicate`; then `checked`, `paidLookups`, `shown`.
- To report why the gate said no, `alternativeGate` needs to say which rule failed. Add a sibling
  that returns the reason (`alternativeGateReason(...)` returning `'ok' | 'kind' | 'unverified' |
  'userLabel' | 'standard' | 'suspect' | 'irritant' | 'unrated'`) and build the boolean gate on
  it, so there is one copy of the rules. The boolean result must not change for any input.
- No product name, brand, JAN code, URL or user text in the line.
- Tests: the line for a mocked shop search has the expected counts; the gate's boolean output is
  unchanged (compare old and new over the existing test fixtures); the line never contains a
  product name from the fixtures.

### 0b. A fixed evaluation run

- `scripts/eval-alternatives.mts`: 24 cases (8 kinds × 3 suspects: 香料, エタノール,
  フェノキシエタノール). For each, call `findShopAlternatives` with paid lookups off and print one
  table row from the same counts as the log line.
- It reads the shop keys from the environment the owner provides when running it. It prints
  counts only, never a key, a product name or shop text.
- With no keys it says so and exits without calling anything.
- The table goes into this document under "Measurements", dated, before and after each path.
- Not done by the implementer: running it against the real shops (the keys are the owner's).

Done when: the log line and the script exist and are tested with mocked shops.

## Path 1. Finer kinds for the search

Goal: a cleansing oil gets makeup removers, a 乳液 gets 乳液, a lip balm gets no lipstick.

- Keep `Product.category` and `AlternativeCategory` as they are. Add a sub-kind in
  `src/lib/analyzer/product-category.ts`, read from the name with fixed words:

| Kind | Sub-kinds (words) |
|---|---|
| cleanser | `makeup_remover` (クレンジング, メイク落とし, リムーバー) / `face_wash` (洗顔, ウォッシュ, フォーム, 石けん) |
| cream | `milk` (乳液, ミルク, エマルジョン) / `gel` (ジェル, ゲル) / `all_in_one` (オールインワン) / `eye` (アイクリーム, 目元) / `hand` (ハンド) / `body` (ボディ) / `face_cream` (クリーム, none of the others) |
| sunscreen | `body` (ボディ, からだ用) / `base` (下地, トーンアップ, ベース) / `face` (顔用, フェイス) |
| lip | `lip_care` (リップクリーム, リップバーム, 薬用リップ, リップケア) / `lip_color` (口紅, ルージュ, ティント, グロス) |
| mask | `sheet` (シート, 枚入り) / `wash_off` (洗い流す, クレイ, 泥, ピールオフ) |
| toner | `body_lotion` (ボディ) / `wipe_off` (拭き取り, ふきとり) |

- Order matters where words overlap (クレンジングミルク is a makeup remover, ボディミルク is body,
  ハンドクリーム is hand). Write the order down in the code comment, as `CATEGORY_WORDS` does.
- Matching rule for a candidate, when the analysed product has a sub-kind:
  - its name says a different sub-kind of the same kind: dropped (`otherKind`);
  - its name says the same sub-kind: kept, ranked first;
  - its name says no sub-kind: kept, ranked after the matches. (Dropping these would empty kinds
    where sellers rarely write the word.) Exception: `hand`, `body`, `eye`, `lip_color`,
    `makeup_remover` and `body_lotion` require the same sub-kind, because a face product is not
    an alternative for them and the reverse.
- When the analysed product has no sub-kind, candidates that say `hand`, `body`, `eye`,
  `lip_color` or `body_lotion` are dropped; the rest behave as today.
- Shop search: the keyword is the sub-kind's Japanese label when there is one (クレンジング, 乳液,
  リップクリーム, シートマスク, ボディクリーム, ハンドクリーム, オールインワンジェル, アイクリーム). Genre IDs:
  use only IDs that were checked against the shops. Checked on 2026-10-18: 乳液 (Rakuten 216387,
  Yahoo! 1766) and クレンジング (Rakuten 405100, Yahoo! 48902), besides the eight in `GENRES`. For a
  sub-kind with no checked ID, search by keyword without a genre and let the name filter decide.
  Do not guess an ID.
- The same sub-kind rule applies to saved products in `findSafeAlternatives` (through the gate
  options), so the analysis card, the comparison card and the chat agree.
- オールインワン has no kind today. Add it as kind `cream`, sub-kind `all_in_one`.
- Not in this path: hair care, shampoo, body wash, primer and powder stay without a kind.
- Tests: a table of at least 40 real-looking names → kind and sub-kind, including the overlap
  cases; shop search keyword and genre per sub-kind; the drop and rank rules; the existing
  alternatives tests (105 to 107 and the gate tests) unchanged.

Done when: the tests pass, and the Path 0 run (by the owner) shows no kind that used to return
results now returning none.

Done 2026-11-17 (test 166; the owner's Path 0 run is still to do):

- `product-category.ts`: `SubKind`, `subKindFromText`, `productSubKind`, `mostCommonSubKind` and
  `subKindFit` (`same` / `unsaid` / `other`), with the table and its word order in a Japanese comment.
  The gate takes `subKind` with `category` and returns `kind` for a sub-kind mismatch (counted as
  `otherKind`); `findSafeAlternatives` and the shop step put `same` before `unsaid` (stable sort).
  The analysis card, the comparison (most common sub-kind among the 肌荒れしたコスメ of that kind)
  and the chat (sub-kind from the text when the text names the kind) all pass it.
- Shop search: the plan's labels (no genre except 乳液 and クレンジング), plus three labels the plan
  did not list, because the kind's search would come back almost empty after the name filter:
  `gel` 保湿ジェル, `body_lotion` ボディローション, sunscreen `body` 日焼け止め ボディ (no genre).
  Sub-kinds with no label (face wash, face cream, face and base sunscreens, lip colour, wash-off
  pack, wipe-off toner) keep the kind's label and genre, as today.
- The log line has `subKind` after `kind` (null when none).
- Additions beyond the table: kind words オールインワン (cream, before toner and serum),
  スキンコンディショナー (toner), モイスチャライザー (cream), メイクリムーバー (cleanser, before
  lip) and ティントリップ (lip). A name for both face and body (顔・からだ用, フェイス&ボディ) gets
  no face or body sub-kind.
- Seed names that had no kind: ナチュリエ スキンコンディショナー is now toner and ラ ロッシュ ポゼ
  … フェイスモイスチャライザー is now cream (no sub-kind). The other seven still get no kind,
  because their names do not say it (ヒアルロン液, 薬用バーム, ピュアスキンジェリー, ボディウォッシュ,
  ウオーター, H2O, ジェントルウォッシュ ホイップ).
- Unchanged: for names with no sub-kind word, the gate reasons, `findSafeAlternatives`,
  `analyzeProduct`, `performDifferentialAnalysis` and the mocked shop search give the same output
  as before (a throwaway comparison over 400 synthetic products). Test 106 now expects
  「シートマスク 無香料」 with no genre for a sheet mask (was 「パック 無香料」); test 164 expects
  `subKind: null`.
- Not done: the web research query (`buildAlternativeQuery`) still uses the kind's label; hair
  creams still classify as cream (`face_cream` by name).

## Path 2. Rank by form and use

Goal: for a mist, mists first. Ranking only; nothing is dropped for form.

- New `src/lib/analyzer/product-form.ts`: read from a name, with fixed word lists,
  - form: `mist` (ミスト, スプレー), `gel` (ジェル, ゲル), `milk` (ミルク, 乳液), `cream` (クリーム),
    `stick` (スティック), `powder` (パウダー), `oil` (オイル), `balm` (バーム), `foam` (泡, フォーム,
    ホイップ), `water` (ウォーター, 水), `sheet` (シート);
  - use: `face` / `body`; for sunscreens the SPF number, the PA level and ウォータープルーフ.
- A similarity score between the analysed product and a candidate: same form, then same use,
  then SPF within one band and waterproof alike (sunscreens), then 無香料 and アルコールフリー as
  today. Sort candidates by sub-kind match (Path 1), then this score; the sort is stable, so
  ties keep today's order.
- Shop keyword: add the form word when the analysed product has one and the kind is one where
  sellers write it (sunscreen, cleanser, cream). At most one form word, and the total of fixed
  words stays at two, so a form word replaces the second of today's words when there are two.
- No extra shop calls and no extra paid lookups. The shop step may go on checking free sources
  (saved by JAN code, Rakuten caption) past the first `limit` passing candidates, up to the
  existing `MAX_CANDIDATES`, so that a better-matching one can be found; the paid step is
  unchanged.
- The request needs the analysed product's name for this. It is already on the server
  (`alternativeRequestFromProduct`); from the comparison list use the most common form among
  the 肌荒れしたコスメ, or none.
- Tests: form and use from names; ordering for the mist case (ビオレUV アスリズム プロテクトミスト
  lists a mist before a gel when both pass); the keyword rule; no change in which products pass.

Done when: the tests pass and the mist case orders correctly.

Done 2026-11-17 (test 167):

- `src/lib/analyzer/product-form.ts`: `formFromText`, `formProfile(text, kind)` (form; use face or
  body, none for a name that says both; SPF, PA and ウォータープルーフ only for sunscreens),
  `mostCommonForm` and `formSimilarity` (same form 100, same use 10, then 1 each for the same SPF
  band (under 30 / 30 to 49 / 50 and over), the same PA level, and both waterproof). Only what
  the analysed product says is compared. Word order is in a Japanese comment (オイルフリー and
  ノンオイル are not oil; 化粧水, 保水, 防水 and ウォータープルーフ are not water).
- Order everywhere: same sub-kind, then similarity, then (saved products only) 無香料 and
  アルコールフリー as before. Stable sorts; nothing is dropped for form.
- The request carries the form profile (never the name): from the analysed product's name, from
  the text, or from the comparison list (the most common form among the 肌荒れしたコスメ of that
  kind). The web research query is unchanged.
- Shop keyword: one form word for sunscreen, cleanser and cream, only when the label does not
  already say a form (so 乳液 and ハンドクリーム get none, and cream in practice gets none); it
  replaces the second ingredient word. The log line's `terms` now shows the words actually sent.
- Shop loop: when there is a sub-kind or a form profile to rank by, the free checks continue past
  `limit` until `limit` best-possible candidates are found or `MAX_CANDIDATES` is reached; then a
  stable sort and a cut to `limit`. No extra shop call; the paid step is unchanged. `checked`
  includes the extra checks, and a new count `notShown` (passed but cut by rank) keeps the counts
  adding up (`checked` = dropped after checking + `shown` + `notShown`). With nothing to rank by,
  the loop stops at `limit` as before. The eval table has no `notShown` column (it searches with
  no sub-kind or form, so it is always 0 there).
- Unchanged for names with no sub-kind or form word: the same throwaway comparison as Path 1
  gives identical output (counts identical apart from `notShown: 0`). Test 164 expects
  `notShown: 0`.

## Review of Paths 0 to 2 (2026-11-18)

One code-improver pass over the three paths. Fixed:

- **A chat sentence that names two products.** The sub-kind and the form are now read only from
  the clause that names the kind being asked for. 「ボディミルクで荒れたので化粧水で探して」 used to
  search body lotions only.
- **Hair and hand products.** Names with ヘア, スカルプ or 頭皮 get no kind (ヘアミルク was a 乳液).
  A hand product that classifies as sunscreen or toner (ハンドクリーム UV, ハンドローション) is `hand`.
- **Lipstick words.** リップスティック, リップライナー, リップペンシル and マットリップ are `lip_color`.
- **Majority for the comparison list.** A sub-kind is used only when more than half of the
  肌荒れしたコスメ of that kind have it; products whose names say none count against it.
- **Descriptive form words.** オイル配合, オイルイン, オイルコントロール, 耐水, 撥水, ウォーターフリー and
  ウォーターレジスタント are not a form, so they no longer add a word to the shop search.
- **The evaluation script** now also runs six sub-kind cases and prints `subKind` and `notShown`
  (30 rows).

Test 168 covers these. Left as they are:

- A cleanser with no sub-kind word still accepts makeup removers. Dropping them is a behavior
  choice for the owner.
- With SPF, PA or waterproof wanted, the free checks usually run through all 30 candidates
  (processing time only; no extra shop call, saved-product read or paid lookup).
- The web-search fallback still asks with the kind's label, not the sub-kind's.

## Measurements

(the owner's runs of `scripts/eval-alternatives.mts` go here, dated)

---

# Plans for later (not started)

## Path 3. More search words for more suspects

- Extend `shopTerms()` in `alternatives-service.ts`. Candidates, by the suspect's ingredient
  category: preservatives → パラベンフリー or 防腐剤フリー; mineral oil → 鉱物油フリー; silicones →
  シリコンフリー; colorants → 無着色; sulfate surfactants → アミノ酸系 or 石けん系; UV absorbers →
  紫外線吸収剤フリー (today ノンケミカル); any → 敏感肌用.
- One word at a time. For each, run Path 0b with and without it: keep it only if the number
  shown goes up or stays level while fetched does not halve.
- Keep the limit of two fixed words; decide the priority order from the measurements.
- Tests: the word chosen for each ingredient category; never more than two.
- Cost: small. Risk: a word that shrinks results; the measurement guards against it.

## Path 4. A wider pool per press

- Two queries per shop (with the fixed words, and the kind alone), or the second page of the
  first query; merge, drop duplicates by JAN code and listing key; raise `MAX_CANDIDATES` from
  30 to 60.
- The shops allow about one call a second per app: keep the calls in sequence with the existing
  interval (`API_INTERVAL_MS` in `shop-apis.ts`). A press takes about 2 seconds longer; show the
  existing progress text.
- Only when the first query gave fewer than `limit` passing candidates, so most presses cost the
  same as today.
- Tests: the second query runs only when needed; duplicates across queries are merged; the
  interval is respected (mocked clock).
- Cost: small. Risk: rate limits under load; the conditional second query limits it.

## Path 5. Better ingredient coverage for shop text

- From Path 0b, add a mode that prints the most common unrated ingredient names per kind (names
  of ingredients only; no product names). Add sourced entries to `ingredients-db.ts` for the top
  ones, as on 2026-10-18 (33 → 119 lists passing).
- Known gaps today: ラノリン, メントール, ポリブテン, カルミン, 合成フルオロフロゴパイト, グンジョウ, LPG,
  3-O-エチルアスコルビン酸, トラネキサム酸, アルブチン, アゼライン酸.
- Each entry needs a source (the cosmetics standard, CIR, SCCS) and a rating reviewed by the
  owner; no entry is added on a model's say-so.
- Raise `MAX_BARCODE_LOOKUPS` from 2 to 3 or 4 if the request budget (`reserveSpend`) shows room,
  and match saved products by identity key as well as JAN code.
- Tests: each new entry (test 93 style); the lookup cap.
- Cost: medium and continuing. Risk: a wrong rating; the source and review requirement covers it.

## Path 6. Fill the saved pool ahead of time

- Extend `SEED_PRODUCTS` (`src/lib/data/seed-products.ts`, 36 names) with about 10 products per
  sub-kind that are sold for sensitive skin, chosen by the owner. The scheduled job
  (`src/worker/seed-schedule.ts`, `seeding.ts`) already reads and refreshes them from trusted
  pages.
- Add a small report to the seeding log: saved, checked products per kind and sub-kind, so thin
  kinds are visible.
- Order the seed work by the Path 0 table: thinnest kinds first.
- Cost: one paid page read per new product, once (about $0.01 each), inside the existing daily
  seeding budget. Risk: spend; the budget cap already exists.
- Tests: the seed list has no duplicates and every name classifies into a kind and sub-kind.

## Path 7. Make the irritant rule relative to the user (needs the owner's choice)

Today a candidate is rejected for any ingredient rated moderate or high. Options:

- (a) Keep it.
- (b) Tolerated ingredients: an ingredient present in the user's 使えるコスメ does not reject a
  candidate. The avoided ingredients always reject. Needs the usable list sent with the request
  (it already is for the comparison) and a note on the card: 「お使いのコスメにも含まれる成分は
  許容しています」.
- (c) Not worse than the analysed product: allow a moderate irritant only if the analysed product
  has it too; name it on the card.
- (d) A second, labelled list of near-misses: 「原因候補は含みませんが、注意成分（エタノール）を含みます」.

Plan once chosen: add the option to `AlternativeGateOptions`, thread the tolerated set from the
routine, change the badge and summary text so they state exactly what was checked, and add tests
for each rule and each text. The legal wording (no claim of safety) needs the same review the
current text had.

## Path 8. Say why there are few results

- When fewer than 3 are shown, `summarizeAlternatives()` adds one sentence from the Path 0
  counts: 「お店の30件のうち、成分表示を確かめられたのは4件でした」, and one next step: the label
  input (to check a product the user is considering) or the words to look for on a package.
- No new call; the counts come back with the result.
- Tests: the sentence for zero, one and two results; none when 3 are shown.
- Cost: small. Do it together with whichever path lands first after Path 0.
