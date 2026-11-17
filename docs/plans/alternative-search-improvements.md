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

- With SPF, PA or waterproof wanted, the free checks usually run through all 30 candidates
  (processing time only; no extra shop call, saved-product read or paid lookup).
- The web-search fallback still asks with the kind's label, not the sub-kind's.

### Next: Yahoo! JAN code → the same item on Rakuten (owner's choice, 2026-11-18)

Yahoo! descriptions almost never carry an ingredient list (390 of ~400 Yahoo! items in the
second run), but most carry a JAN code. For a Yahoo! item still unchecked after the free pass,
search Rakuten for the same item by its JAN code (free API), read the ingredient list from that
Rakuten listing's caption, and offer the product with links to the same item: Rakuten (the
listing, affiliate), Yahoo! (the listing), Amazon and Qoo10 (the existing affiliate search
links). Amazon and Qoo10 have no product API this app can use and their pages are not fetched.

Rules: before the paid step, only while still short of `limit`, at most a few Rakuten calls per
press in sequence (the shop API allows about one call a second), and a Rakuten listing is used
only when it is the same product (its caption or name carries the same JAN code, and the names
agree). Shop text is used for that reply only. Counts: a new reason or field so the gain shows
in the evaluation script.

Done 2026-11-17 (test 173; the owner's measurement is still to do):

- **Where.** Step 2b in `findShopAlternatives`, after the free pass and before the paid step. It takes
  the Yahoo! items still unchecked that have a JAN code, in relevance order, after the existing
  de-duplication (a JAN code already found or repeated is skipped). It runs only while fewer than
  `limit` have been found, and also with `allowPaidLookups` false, so the evaluation script measures it.
- **The call.** `rakutenItemSearch(jan, { caption: true })`: the keyword is the Yahoo! JAN code (8 to
  14 digits) and nothing else, with no genre. At most `MAX_RAKUTEN_JAN_LOOKUPS` = 3 calls per press
  (enough to fill one press of 3; about 3 s more waiting; 4 Rakuten calls per press against the
  shared 50 a minute). The calls are made one at a time, each at least `API_INTERVAL_MS` (now
  exported) after the previous Rakuten call, the first search included. The step stops after a
  failed or refused call. No KV reads. The paid step is unchanged (still at most 2, the same
  formula), and an item resolved here (shown or rejected by the gate) is not sent to it.
- **Same product.** A returned Rakuten listing is used only when it carries the same JAN code
  (`janFromCaption` on its caption, or the code as a run of digits in its name, compared with
  `normalJan`), its name agrees with the Yahoo! name (`sameListing`), it is not a set
  (`notSingleItem`), and its caption gives a readable list (`ingredientsFromCaption`). The
  product comes from `shopListingProduct` and goes through the same `consider` path and gate
  (`allowShopListing`, `minRatedShare`). It is counted as the Yahoo! candidate. The duplicate check
  also compares the Rakuten listing's name, so a listing already found in the free pass is not
  shown twice.
- **Not verified against the live API.** Nothing in the code or its tests shows that a JAN code
  as the keyword finds listings that only mention it in the caption. The search-scope parameter
  (`field`) is not used or documented in `shop-apis.ts`, so the default scope is sent. The Item
  Search API has no JAN field, so the caption and name are the only places checked. `janSameJan`
  in the table answers this: if `janTried` > 0 and `janSameJan` is 0 everywhere, the keyword does
  not reach captions (or captions rarely carry the code), and `field` is the next thing to try.
- **Shown.** The Rakuten listing: its name (unaltered), photo, price and link (affiliate only,
  through `shopLink`, the same rule as other Rakuten listings), the source link 「楽天市場の商品説明」, and
  the card's Amazon and Qoo10 search links. Credits list Rakuten only, because no Yahoo! data is
  shown. **No Yahoo! link**: `Product` has a single `shopLink`, and the card shows no second shop
  link; carrying one would need a new field, validation and a new card element.
- **Counts.** `janToRakuten: { tried, sameJan, found }` (calls made; calls that returned a listing
  with the same JAN code; items whose list was read and sent to the gate). The identity is
  unchanged: an item resolved here is counted under the gate's reason, `duplicate` or `shown`,
  no longer `noList`. In the log line through the shop counts; in the script as `janTried`,
  `janSameJan` and `janFound` before `paid`. The script passes its interval to the new
  `shopCallIntervalMs` input (production uses `API_INTERVAL_MS`).
- **Tests.** Changed: 164 (the new counts field), 165 (new columns; the step's requests are
  checked apart from the kind searches; the Yahoo! fixture uses a JAN code that no other test saves,
  and the memory per-minute cap is raised for the run, since 30 cases at interval 0 now make
  more than 50 Rakuten calls), 170 (`shopCallIntervalMs: 0`, because the step now runs there
  and would wait about 11 s; no assertion changed). `mockShops` can answer JAN-code searches.
- **Unchanged without JAN codes.** A throwaway comparison over 12 mocked searches (24 runs, with and
  without the affiliate ID) where no Yahoo! item has a JAN code gives the same products, credits,
  counts and requests before and after.
- **Watch in the measurement.** With 30 cases, one Rakuten call every 1.1 s plus the response
  time comes close to the memory counter's 50 calls a minute (`spend-cap.ts`). If the run logs
  「Rakuten item search skipped: rate limit reached」, that case's counts are short. Rerun it with
  `SPEND_PER_MINUTE_RAKUTEN_API` set a little higher for the script's own process. The spacing
  still keeps to one call a second.

Review of `761eb19` (one code-improver pass; bounds, privacy and the counts identity hold).
Fixed in the next commit, test 174:

- When a Rakuten caption gives a JAN code, that code decides; a matching number in the name no
  longer overrides a different code in the caption.
- Another variant of the same line is not the same product: names must carry the same variant
  words (I/II/III, しっとり/さっぱり/とてもしっとり, SPF and PA values, 無香料).
- The spacing is counted from when the first Rakuten search ends, no JAN call is made when that
  search failed, and the step stops after 6 seconds.

Not done: two presses at the same moment can still call Rakuten together (it needs a shared
throttle in the shop client), and test 165 avoids an earlier test's saved product by using a
different JAN code rather than that test cleaning up after itself.

### 2026-11-18, third run, with the Rakuten-by-JAN step (commits `761eb19`, `0d49843`)

Same 30 cases, limit 3, paid lookups off, run by the owner on the local code.

| | Second run | Third run |
|---|---|---|
| Shown (of 90) | 44 | **45** |
| Yahoo! items looked up on Rakuten (`janTried`) | - | 58 |
| ... a Rakuten listing carried the same JAN code (`janSameJan`) | - | 32 (55%) |
| ... used (`janFound`) | - | 5 |
| No readable list (Rakuten / Yahoo!) | 459 / 390 | 462 / 380 |

What it shows:

- **Rakuten's keyword search does reach captions:** 32 of 58 JAN lookups found a listing that
  carries the same JAN code. The open question from the plan is answered.
- **Few of them become alternatives:** 5 of 32. The other 27 were dropped by one of: no readable
  list in that listing's caption, a set listing, the names not agreeing, or different variant
  words. The run does not say which; that split is the next thing to count.
- **Shop results move between runs**, so a difference of one or two per case is noise: cream with
  香料 showed 3 in the second run and 1 in this one, with the same code path for that case. The
  net gain of this step is about +1 to +3 of 90, not a clear win yet.
- Each press still short of three now makes up to 3 more Rakuten calls (about 3 seconds).

Added 2026-11-17 (test 175; measurement only, the owner's rerun is still to do): each Yahoo! item
whose lookup found a same-JAN listing but was not used is now counted once, under
`janToRakuten.why`, by the furthest check any of its same-JAN listings reached, in this order: `set`
(`notSingleItem`), `name` (`sameListing`), `variant` (`variantMarks`), `noCaption`, `noList`
(`ingredientsFromCaption` read nothing); a used item is `found`. So `tried` = (`tried` − `sameJan`) +
`set` + `name` + `variant` + `noCaption` + `noList` + `found`. `janToRakuten.nameLoose` counts the `name`
items that would pass if both names also dropped (…), ≪…≫, 《…》, 〈…〉 and ◆…◆-style parts and a leading
「shop / 」 or 「shop|」 prefix (【…】 and ［…］ were already dropped by `withoutListingNoise`); the rule
itself is unchanged. The checks now run in that order (the caption check moved from first to
fourth); since they are plain conditions, the accepted listing, the order and the calls are the same:
a throwaway comparison of tests 173 and 174's searches plus four more gave identical products,
credits, requests and counts apart from the new fields. Note that a different variant word usually
fails `name` first (the words are part of the series key), so `variant` only counts cases where one
name contains the other. The log line carries both through the shop counts; the script adds
`janSet`, `janName`, `janNameLoose`, `janVariant`, `janNoCaption` and `janNoList` between `janSameJan`
and `janFound`. Tests 164, 165, 173 and 174 now expect the new fields.

### 2026-11-18, second run, after the free-sources-first change (commits `81d1891`, `ea1f829`)

Same 30 cases, limit 3, paid lookups off, run by the owner on the local code.

| | First run | Second run |
|---|---|---|
| Shown (of 90) | 31 | **44** |
| Cases with 3 shown | 7 | 10 |
| Cases with nothing | 13 | 10 |
| Checked | 797 | 1,033 |
| No readable list | 705 | 849 (Rakuten 459, Yahoo! 390) |
| Rejected by the gate (suspect + irritant + unrated) | 57 | 91 |

Per case, the gains are where Rakuten captions sat beyond the old cap: cleanser 2/1/1 (was 1/0/1),
cream 3/1/1 (was 1/1/0), sunscreen with 香料 3 (was 2), mask with 香料 3 (was 2), lip with
エタノール 3 (was 2), foundation 3/2/3 (was 3/0/1), toner with エタノール 1 (was 0). No case shows
fewer than before.

What it shows:

- **The reorder worked**: about 30% more candidates checked and 13 more shown, with no extra call.
- **Rakuten captions are now the limit.** About 20 of 30 Rakuten items per case have no readable
  list (459 in all). Reading more of them needs Path 5 (coverage) and better caption cutting, not
  more ordering.
- **Serum still shows nothing** in all three cases; most candidates have no list.
- **Body sunscreen and sheet masks still show nothing.** The genre did not help: body sunscreen
  drops 27 of 37 as another kind (the items in the sunscreen genre found by 「日焼け止め ボディ」
  rarely say ボディ in the name), and sheet masks still lose 17 as sets. Both need a look at the
  actual listings before another rule is written.
- **The irritant rule rises with what is read** (45 → 69). As more lists become readable it
  becomes the next limit, which is where Path 7 comes in.

## Review of the 2026-11-18 next steps (commit `81d1891`)

One code-improver pass. No critical or high finding; bounds, the counts identity, the paid
step's order and the shown order were walked by hand and hold. Fixed:

- A paid lookup is no longer spent on a JAN code that was already found or that a second
  listing repeats (counted as `duplicate`).
- For sheet masks, a bare multi-buy such as 「1枚×5袋 3セット」 is dropped; removing the pack part
  had hidden it.
- 「全身にも使える」 is not body-only.

## Owner's decision on cleansers (2026-11-18)

A cleanser candidate must say what it washes: face wash, makeup remover or body wash. One whose
name says none is not offered, for any cleanser. The three are strict (only the same one is an
alternative). When the analysed product's own name says none, only face washes are offered.
Body wash (ボディソープ, ボディウォッシュ, ボディシャンプー) is now kind `cleanser`, sub-kind `body_wash`,
searched as 「ボディソープ」 without a genre. Test 169.

## Measurements

### 2026-11-18, after Paths 0 to 2 and the cleanser rule (commit `e413473`)

Run by the owner against the real shops: 30 cases, limit 3 (one button press), paid lookups off.
There is no "before" run, so this is the baseline for Paths 3 to 8, not a before/after comparison.

| kind | subKind | avoid | terms | rakuten | yahoo | otherKind | notSingle | noList | suspect | irritant | unrated | checked | notChecked | shown |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cleanser | - | 香料 | 無香料 | 30 | 24 | 6 | 9 | 27 | 0 | 2 | 0 | 30 | 9 | 1 |
| cleanser | - | エタノール | アルコールフリー | 30 | 26 | 3 | 5 | 29 | 0 | 1 | 0 | 30 | 18 | 0 |
| cleanser | - | フェノキシエタノール | - | 30 | 29 | 2 | 4 | 24 | 1 | 4 | 0 | 30 | 23 | 1 |
| toner | - | 香料 | 無香料 | 30 | 29 | 3 | 7 | 27 | 0 | 1 | 0 | 30 | 19 | 2 |
| toner | - | エタノール | アルコールフリー | 30 | 29 | 0 | 7 | 28 | 0 | 0 | 2 | 30 | 22 | 0 |
| toner | - | フェノキシエタノール | - | 30 | 28 | 4 | 5 | 29 | 0 | 1 | 0 | 30 | 19 | 0 |
| serum | - | 香料 | 無香料 | 30 | 26 | 4 | 6 | 27 | 1 | 0 | 1 | 30 | 17 | 0 |
| serum | - | エタノール | アルコールフリー | 30 | 27 | 5 | 3 | 30 | 0 | 0 | 0 | 30 | 19 | 0 |
| serum | - | フェノキシエタノール | - | 30 | 29 | 2 | 2 | 28 | 1 | 1 | 0 | 30 | 25 | 0 |
| cream | - | 香料 | 無香料 | 30 | 30 | 3 | 10 | 29 | 0 | 0 | 0 | 30 | 17 | 1 |
| cream | - | エタノール | アルコールフリー | 30 | 21 | 1 | 5 | 26 | 0 | 3 | 0 | 30 | 15 | 1 |
| cream | - | フェノキシエタノール | - | 30 | 29 | 3 | 4 | 26 | 1 | 3 | 0 | 30 | 22 | 0 |
| sunscreen | - | 香料 | 無香料 | 30 | 26 | 3 | 11 | 25 | 0 | 2 | 1 | 30 | 12 | 2 |
| sunscreen | - | エタノール | アルコールフリー | 30 | 23 | 0 | 8 | 26 | 0 | 4 | 0 | 30 | 15 | 0 |
| sunscreen | - | フェノキシエタノール | - | 30 | 28 | 1 | 1 | 26 | 0 | 4 | 0 | 30 | 26 | 0 |
| mask | - | 香料 | 無香料 | 30 | 22 | 10 | 11 | 25 | 0 | 2 | 1 | 30 | 1 | 2 |
| mask | - | エタノール | アルコールフリー | 30 | 27 | 15 | 5 | 29 | 0 | 1 | 0 | 30 | 7 | 0 |
| mask | - | フェノキシエタノール | - | 30 | 29 | 9 | 9 | 29 | 0 | 1 | 0 | 30 | 11 | 0 |
| lip | - | 香料 | 無香料 | 30 | 27 | 5 | 18 | 24 | 0 | 4 | 0 | 30 | 5 | 1 |
| lip | - | エタノール | アルコールフリー | 29 | 25 | 2 | 8 | 27 | 0 | 1 | 0 | 30 | 14 | 2 |
| lip | - | フェノキシエタノール | - | 30 | 29 | 10 | 3 | 22 | 0 | 3 | 1 | 30 | 18 | 2 |
| foundation | - | 香料 | 無香料 | 30 | 29 | 1 | 2 | 13 | 0 | 1 | 0 | 17 | 39 | 3 |
| foundation | - | エタノール | アルコールフリー | 29 | 20 | 1 | 3 | 30 | 0 | 0 | 0 | 30 | 15 | 0 |
| foundation | - | フェノキシエタノール | - | 30 | 30 | 2 | 1 | 28 | 0 | 0 | 1 | 30 | 27 | 1 |
| cleanser | makeup_remover | 香料 | 無香料 | 30 | 28 | 0 | 6 | 5 | 0 | 0 | 0 | 8 | 44 | 3 |
| cream | milk | 香料 | 無香料 | 30 | 25 | 9 | 5 | 1 | 0 | 0 | 0 | 4 | 37 | 3 |
| cream | hand | 香料 | 無香料 | 30 | 25 | 2 | 9 | 17 | 0 | 4 | 0 | 24 | 20 | 3 |
| sunscreen | body | 香料 | 無香料 | 30 | 7 | 28 | 5 | 3 | 0 | 1 | 0 | 4 | 0 | 0 |
| lip | lip_care | 香料 | 無香料 | 30 | 24 | 4 | 14 | 26 | 0 | 1 | 0 | 30 | 6 | 3 |
| mask | sheet | 香料 | 無香料 | 30 | 22 | 12 | 20 | 19 | 0 | 0 | 1 | 20 | 0 | 0 |
| all | | | | 898 | 773 | 150 | 206 | 705 | 4 | 45 | 8 | 797 | 522 | 31 |

Columns that were 0 in every row are left out (`excluded`, `standard`, `duplicate`, `notShown`,
`paid`).

What it shows:

- **31 shown of a possible 90.** 13 of 30 cases show nothing; 7 show all three.
- **The loss is the missing ingredient list, not the gate.** Of 797 candidates checked, 705 (88%)
  had no readable list and no saved product. The gate itself rejected 57 (45 for another irritant,
  4 for the suspect, 8 for too many unrated names).
- **The irritant rule is not the main limit in this run** (45 of 797), against what the report
  expected. It may matter more once more lists can be read.
- **Sub-kind searches do well where a checked genre exists:** makeup remover and 乳液 found three
  after checking 8 and 4 candidates.
- **Two sub-kind searches find nothing:** `sunscreen/body` (Yahoo! returns 7 items and 28 of 37
  are dropped as another kind: without a genre, 「日焼け止め ボディ」 brings items that do not say
  body) and `mask/sheet` (20 of 52 are sets or multi-packs, which `NOT_SINGLE_ITEM` drops; sheet
  masks are sold by the pack).
- **アルコールフリー finds little:** 0 shown in 6 of the 8 kinds.
- **Serum shows nothing** for all three suspects.
- **Half of each 30 checked are probably Yahoo! items**, which almost never carry a list (3% on
  2026-10-18). Candidates alternate between the shops and the cap is 30, so only about 15 Rakuten
  captions are read while up to 15 more are fetched and never looked at (`notChecked` 522).

What to do next, in order of expected gain:

1. **Read every Rakuten caption before spending the cap on Yahoo! items** (free: no extra call).
   Put candidates that can be checked for free first (Rakuten with a caption, Yahoo! with a JAN
   code that matches a saved product), or raise `MAX_CANDIDATES` to cover all 60. This is the
   cheap half of Path 4.
2. **Path 6 (fill the saved pool)** and **Path 5 (coverage)**: the only ways to turn `noList`
   into checked products. In production the two paid lookups per press help a little; this run
   had them off.
3. **Sheet masks:** let a pack of sheets count as one item for the `sheet` sub-kind.
4. **`sunscreen/body`:** find and pin a checked genre ID, or search 「ボディ 日焼け止め」 inside
   the sunscreen genre.
5. Add the shop to the `noList` count so the split between Rakuten and Yahoo! is measured, not
   estimated.

Done 2026-11-18 (items 1, 3, 4 and 5; tests 170 to 172; the owner's re-run is still to do):

- **1. Free sources first.** Order of checking: candidates with a free source (a Rakuten caption, or a
  Yahoo! JAN code that matches a saved product), in the interleaved relevance order, up to
  `MAX_CANDIDATES`; then, only if still short, the rest (no work: a JAN code goes to the paid pool,
  no JAN code is `noList`); then the paid step as before (at most 2, first unchecked JAN codes in the
  original relevance order, even when the free checks used the whole cap). Decision: **reorder only,
  `MAX_CANDIDATES` stays 30.** A shop page is 30 items, so 30 free checks cover every Rakuten caption
  that survives the name filters; going past 30 would only add saved Yahoo! matches (rare) and more
  sequential caption parsing. KV reads: the first 30 items with a JAN code (Yahoo! returns at most 30,
  so in practice every Yahoo! item; the same maximum as before). Shown order: rank (sub-kind, then
  form) first, then the shops' relevance order (interleaved position), not the order found, so a
  Yahoo! item found by the paid step can come before a lower-ranked Rakuten one; credits still
  follow what is shown. `checked` now includes the no-source items looked at in the second pass,
  so expect higher `checked` and `noList`, lower `notChecked`. With every candidate free and under
  the cap, the shown set, order, credits and counts are unchanged (throwaway comparison, 9 mocked
  searches). Test 164 changed: the Yahoo! item with no source is no longer checked before three
  are found (`noList` 2 → 1, `checked` 9 → 8, `notChecked` 1 → 2).
- **3. Sheet masks.** `NOT_SINGLE_ITEM` never matched 「7枚入り」 or 「30枚」 (it does not count 枚);
  it matched 「1枚×5袋」 and 「(1枚入)×10個」 through its 「×N 個/袋/箱」 pattern. For the `sheet`
  sub-kind only, that 「1枚 × N」 part is ignored before the test, and assortments
  (「5種セット」「アソート」「詰め合わせ」「よりどり」「選べる」, which `NOT_SINGLE_ITEM` does not catch)
  are dropped. Sets (「2個セット」「3袋セット」「7枚入り×3袋」「まとめ買い」「福袋」) still drop. So
  the 20 `notSingle` in the measurement were probably mostly real sets; the re-run will tell.
  `NOT_SINGLE_ITEM` itself is unchanged.
- **4. Genres.** `sunscreen/body` and `mask/sheet` now search in their kind's genre (checked IDs
  in `GENRES`). Left without a genre: body wash, body lotion, hand, body and eye creams,
  all-in-one (other shop genres), 保湿ジェル (unknown whether the cream genre holds it), lip care
  (the lip genre may be the colour side; it already finds three without a genre). Body wording:
  `BODY_ONLY` already had ボディ (so ボディ用), からだ用, 体用 and 全身用; added カラダ用 and 全身
  without 用 (not 全身性). Bare からだ / カラダ are not body words (「からだにやさしい」); a name with
  顔 or フェイス is never body-only. The body sub-kind stays strict.
- **5.** `noListByShop: { rakuten, yahoo }` next to `dropped.noList` (total), in the log line and as
  `noListRakuten` / `noListYahoo` columns in the script (test 165 changed for the new columns).
- Also changed: test 106 and 166 expect the genre for the sheet mask and body sunscreen searches.
- Not done: item 2 (Paths 5 and 6); English 「BODY」 is not read as body (it would also catch
  ザ・ボディショップ, which ボディ already does today).

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
