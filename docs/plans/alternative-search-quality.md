# Report: why the alternatives search is uneven across product kinds, and how to improve it

Written 2026-11-18. Status: report only; nothing is implemented. Subject: the search behind
「💡 原因候補を含まないアイテムは？」 and the card button 「同じ種類で原因成分を含まない商品を探す」
(`src/lib/services/alternatives-service.ts`, `shop-alternatives.ts`, `alternativeGate` in
`src/lib/analyzer/ingredient-analyzer.ts`, `src/lib/analyzer/product-category.ts`). The earlier
plan is [alternative-recommendations.md](alternative-recommendations.md); its steps 1 to 3 are built.

How this was examined: reading the code path end to end, the measurements recorded on 2026-10-18
and 2026-10-19 in the earlier plan, and two small local checks (how the 36 seed product names are
classified, and how typical ingredients of each kind are rated by the gate).

Not measured: live results per kind. The shop keys are not available locally and the saved
products live in production storage, so there are no current per-kind hit rates. Path 0 below
closes that gap and should come first.

## How the search works today

1. Decide the kind (one of eight: cleanser, toner, serum, cream, sunscreen, mask, lip, foundation)
   and the ingredients to avoid.
2. Look in the saved, checked products of that kind.
3. If fewer than 3: one search per shop (Rakuten, Yahoo!), keyword = the kind's label plus at most
   two fixed words (無香料, アルコールフリー, ノンケミカル), limited to one shop genre, 30 items each.
   Check up to 30 of them: a saved product by JAN code, else the ingredient list in the Rakuten
   caption, else (at most 2) a paid lookup by JAN code.
4. If still fewer than 3: one paid web search (「敏感肌 {kind} {terms} 全成分」) and re-check.
5. Every candidate must pass the same gate: same kind, none of the avoided ingredients, no
   ingredient rated moderate or high irritant, and for shop text at least 80% of ingredients rated.

The gate is code only, which is why a wrong product is rare. The cost is that most candidates are
dropped, and how many survive depends heavily on the kind.

## Why it is hard

### 1. Eight kinds are too coarse, and the kind is read from one word in the name

`categoryFromText()` takes the first matching word. What falls inside one kind is often not
interchangeable, and some products get no kind at all.

| Kind | What it also swallows | What the shop search asks for |
|---|---|---|
| cleanser | Face wash and makeup remover (oil, balm, milk, water) | 「洗顔料」 in the 洗顔 genre only, so a cleansing oil gets face washes |
| cream | 乳液, ミルク, 保湿ジェル, and by name also hand, body, eye and hair creams | 「クリーム」 in the クリーム genre only |
| toner | Anything named ローション, including body lotion | 「化粧水」 |
| sunscreen | Face and body, mist, gel, milk, stick, and tone-up bases named UV | 「日焼け止め」, no form, no face or body |
| lip | Lip balm and lipstick, tint, gloss | 「リップ」 |
| mask | Sheet masks and wash-off packs | 「パック」 |
| serum, foundation | Fewer problems; BB and CC creams count as foundation | 「美容液」, 「ファンデーション」 |

- No kind exists for all-in-one gel, eye care, body care, hair care, shampoo, primer or powder.
  Those products get 「種類が分からない」 and no search.
- Of the 36 seed product names, 9 (25%) get no kind from the name: 肌ラボ 極潤 ヒアルロン液,
  ナチュリエ スキンコンディショナー, アベンヌ ウオーター, ビオデルマ サンシビオ H2O, ミノン ジェントルウォッシュ
  ホイップ, イハダ 薬用バーム and others. A saved product can still carry a kind from the page read,
  but only one of the same eight.
- Of the 6 seed sunscreens, 3 are bases or tone-up products.

### 2. One search of 30 items cannot be both "same kind" and "free of the suspect"

- The keyword carries only three possible words. For any other suspect (a preservative, a
  surfactant, a specific UV filter) the search is just the kind's name, so the 30 items are the
  shop's top sellers of that kind, and whether one avoids the suspect is chance.
- There is no second page, no second query, and no ranking by form or use. Step 4 of the earlier
  plan (rank by form: mist, gel, milk, stick; face or body; SPF band) was never built.

### 3. Most candidates cannot be checked, and the share differs by kind

Measured 2026-10-18 on 13 queries × 30 items per shop:

- 61% of Rakuten captions had an ingredient heading; 3% of Yahoo! descriptions did.
- After the ingredient database additions, 119 of 152 parsed lists reached the 80% bar.
- On 2026-10-19 with the real APIs: sunscreen 2 results, cleanser 3, serum 1, toner 0. Only 4 of
  30 toner captions had a readable list.
- Paid lookups are capped at 2 per press, by JAN code only.

### 4. The gate's "no moderate or high irritant" rule removes whole kinds

The gate rejects a candidate for any moderate or high irritant, whether or not the user reacted to
it. Typical ingredients of each kind, as the gate rates them today:

| Kind | Common ingredients that reject a product | Common ingredients that are unrated (count against the 80% bar) |
|---|---|---|
| cleanser | ラウレス硫酸Na (moderate), オレフィン(C14-16)スルホン酸Na (moderate), ラウリル硫酸Na (high) | — |
| sunscreen | エタノール (moderate), オクトクリレン (moderate) | LPG (spray propellant) |
| toner | エタノール (moderate), PG (moderate) | — |
| lip | 香料 (high) | ラノリン, メントール, ポリブテン, カルミン |
| foundation | — | 合成フルオロフロゴパイト, グンジョウ |
| serum | — (retinol, acids and vitamin C are "active caution", which the gate allows) | 3-O-エチルアスコルビン酸, トラネキサム酸, アルブチン, アゼライン酸 |
| cream | 香料 (high) | — |

So a user whose suspect is a preservative gets no ethanol-containing sunscreen or toner and no
fragranced cream or lip product, even though they never reacted to ethanol or fragrance. That is a
safety choice, and it is the largest single reason some kinds return little.

### 5. The saved pool is whatever people happened to look up

Step 2 answers at no cost and with verified sources, but its contents follow past lookups, not the
kinds users ask about. No job fills it per kind.

### 6. Nothing records how a search went

There is no log line or counter for an alternatives search (kind, items fetched, dropped by which
rule, shown). So "not accurate enough for some kinds" cannot be turned into numbers today.

## Paths to better results

All of them keep the rule that code, not a model, decides what is shown.

| # | Path | Fixes | Cost | Risk |
|---|---|---|---|---|
| 0 | Measure: outcome log and a fixed evaluation set | cause 6; makes every other path testable | Small | None |
| 1 | Finer kinds for the search (sub-kinds, genre and keyword per sub-kind) | cause 1 | Medium | Low |
| 2 | Rank and filter by form and use (earlier plan's step 4) | causes 1, 2 | Small to medium | Low |
| 3 | More search words for more suspects | cause 2 | Small | Low |
| 4 | A wider candidate pool per press | causes 2, 3 | Small | Shop rate limits |
| 5 | Better ingredient coverage for shop text | cause 3 | Medium, ongoing | Low |
| 6 | Fill the saved pool ahead of time, per kind | causes 3, 5 | Medium; some paid reads | Spend |
| 7 | Make the irritant rule relative to the user | cause 4 | Medium | **Owner decision: safety** |
| 8 | Say why there are few results, and offer the next step | all (honesty, not accuracy) | Small | None |

### Path 0. Measure first

- Add one counts-only log line per search: kind, sub-kind, number of avoided ingredients, items
  fetched per shop, dropped by reason (other kind, set or refill, excluded, no readable list,
  contains suspect, contains other irritant, under 80% rated), shown, and which step answered
  (saved, shop, web). No product names, no user text.
- Add a script like the 2026-10-18 one: about 24 fixed cases (8 kinds × 3 common suspects:
  fragrance, ethanol, a preservative), run against the real shop APIs with keys from the
  environment, printing the same counts as a table. Record the table in this document before and
  after each path.
- Done when: the table exists and shows, per kind, where candidates are lost.

### Path 1. Finer kinds for the search

- Keep `Product.category` as it is. Add a search sub-kind derived from the name with fixed words:
  cleanser → 洗顔 / クレンジング (oil, balm, milk, water); cream → クリーム / 乳液 / ジェル /
  オールインワン / アイ / ハンド / ボディ; sunscreen → 顔 / ボディ; lip → リップクリーム / 口紅・ティント;
  mask → シート / 洗い流す; toner → 化粧水 / ボディローション.
- Give each sub-kind its own keyword and shop genre IDs (look them up once and pin them with the
  date, as `GENRES` does now).
- A candidate must match the sub-kind when the analysed product has one.
- Add the missing kinds only where a shop genre exists and the gate makes sense (all-in-one, eye
  cream, body lotion, hand cream). Hair care and shampoo stay out until someone asks.
- Also read the kind from the shop's own genre: Rakuten returns `genreId` per item. A reverse map
  classifies items whose names carry no kind word.
- Files: `product-category.ts`, `shop-alternatives.ts`, tests 105 to 107 and new cases.
- Done when: a cleansing oil gets only makeup removers, a 乳液 only 乳液, a lip balm no lipstick,
  and the Path 0 table shows no loss of results for the kinds that worked before.

### Path 2. Rank and filter by form and use

- Read form (ミスト・スプレー, ジェル, ミルク, クリーム, スティック, パウダー, シート) and use (face or body,
  SPF and PA band, ウォータープルーフ) from names with fixed word lists. Sort same-form first; never
  drop for form alone.
- Add the form word to the shop keyword when the analysed product has one (「日焼け止め ミスト」).
- Files: a new `product-form.ts`, `shop-alternatives.ts`, `findSafeAlternatives`.
- Done when: ビオレUV アスリズム プロテクトミスト lists mists or sprays first.

### Path 3. More search words for more suspects

- Extend `shopTerms()` with words sellers really write: パラベンフリー, 防腐剤フリー, 鉱物油フリー,
  シリコンフリー, 無着色, 石けん系 or アミノ酸系 (for sulfate surfactants), 紫外線吸収剤フリー, 敏感肌用.
- Choose at most two by the suspects' ingredient categories. Measure each word with Path 0 first:
  a word that halves the results without raising the pass rate is not added.

### Path 4. A wider pool per press

- Run two queries per shop instead of one (with the fixed words, and without), or fetch a second
  page, and raise `MAX_CANDIDATES` from 30 to about 60.
- Stay inside the shops' one call per second per app: the calls go in sequence with the existing
  interval, so a press takes about 2 seconds longer. Reading captions costs nothing.

### Path 5. Better ingredient coverage for shop text

- From the Path 0 run, list the most common unrated names per kind and add sourced entries for
  them (the 2026-10-18 pass lifted 33 lists to 119). Known gaps: ラノリン, メントール, ポリブテン,
  カルミン, 合成フルオロフロゴパイト, グンジョウ, LPG, 3-O-エチルアスコルビン酸, トラネキサム酸, アルブチン,
  アゼライン酸.
- Raise `MAX_BARCODE_LOOKUPS` from 2 where the request budget allows, and look up by the saved
  product's identity key as well as by JAN code.

### Path 6. Fill the saved pool ahead of time

- The seeding job exists (`src/worker/seed-schedule.ts`, `seeding.ts`, 36 seed names). Extend the
  seed list with products known for sensitive skin in each sub-kind (about 10 per sub-kind, chosen
  by the owner), read from trusted maker pages.
- Then most presses are answered by step 2: free, instant, and with verified sources rather than
  seller text.
- Cost: one paid page read per new seed product, once; the refresh job already exists.

### Path 7. Make the irritant rule relative to the user (owner decision)

Today: never suggest a product with any moderate or high irritant. Options:

- **(a) Keep it.** Safest; some kinds stay thin.
- **(b) Trust what the user already tolerates.** An ingredient that appears in the user's
  使えるコスメ is not a reason to reject a candidate (the user uses it without trouble). The
  avoided ingredients still always reject. This uses data the app already has and is the most
  defensible relaxation.
- **(c) Compare with the analysed product.** Allow an irritant the analysed product did not
  contain only if it is rated moderate, and show it on the card (「エタノールを含みます」).
- **(d) Show near-misses separately.** Keep the strict list, and add a second, clearly labelled
  list of products that avoid the suspects but contain another caution ingredient, with its name.

Whatever is chosen, the badge text must say only what was checked.

### Path 8. Say why there are few results

- When fewer than 3 are shown, state the counts from Path 0 in plain words (「30件のうち、成分表示を
  確かめられたのは4件でした」) and offer the next step: the label input, or the terms to look for on
  a package.

## Recommended order

1. Path 0, so the uneven kinds are known by number.
2. Paths 1 and 2 together: they fix wrong-kind and wrong-form results, which is what users see.
3. Path 3, word by word, measured.
4. Path 4 if the table still shows too few checkable candidates.
5. Paths 5 and 6 as continuing work.
6. Path 7 after the owner chooses an option; Path 8 with whichever comes first.
