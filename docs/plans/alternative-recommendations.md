# Plan: alternatives that are the same kind of product

Written 2026-10-18. Revised the same day after the Rakuten and Yahoo! API keys were set (production
secrets and `.dev.vars`). Status: step 1 done (`2188fc1`); step 2 measured; the Rakuten `Origin` fix and the ingredient additions from step 2 done (2026-10-18). Step 3 implemented 2026-10-19 (`src/lib/services/shop-alternatives.ts`, test 106).

**Step 3 as built (2026-10-19):**
- **Ingredient checks:** the third check (paid lookup) runs only by JAN code, for the top 2
  unchecked Yahoo! items. Name searches are left out (slow and paid).
- **No clef-flash on captions:** the caption reader uses fixed rules only. A test on Cloudflare
  showed Clef deleting real ingredients ([shop-ingredients plan](shop-ingredients.md)).
- **Shop candidates must have 80% or more rated ingredients**, as step 5 asks. Saved, checked
  products keep today's gate.
- **Gate refinement:** an avoided name now matches part of a label item only when the ingredient
  database doesn't know that item. Avoiding エタノール no longer rejects フェノキシエタノール,
  which the database identifies as a different ingredient.
- **Web research as a last step** (owner's decision, 2026-10-19): it runs whenever saved products
  and shops together give fewer than 3. That covers missing shop keys and shop failures, and also
  shops that answer with too few checkable products. Checked web results come first, then the shop
  products, with the same product shown once. Test 107.
- **Same steps for the chat:** 「代わりを探して」 uses them too, and alternatives cards show the
  photo, the price at search time, 「販売ページを見る」 (an affiliate link), 「Amazonで探す」 and
  the credits.
- **Real APIs (no Gemini):** four queries found 0–3 alternatives each within 2 s:
  - sunscreen avoiding UV absorbers and ethanol: 2;
  - cleanser avoiding fragrance: 3;
  - serum avoiding parabens: 1;
  - toner avoiding fragrance and ethanol: 0. Only 4 of 30 toner captions had a readable
    list.

## What happened

A user analysed ビオレUV アスリズム プロテクトミスト (a sunscreen mist). The card's
「原因成分を含まない安心の代替アイテム」 section suggested SHISEIDO MEN Moisturizing Lip Creator,
a lip balm.

## Why

1. **The analysis card ignores the product type.** `analyzeProduct()`
   (`src/lib/analyzer/ingredient-analyzer.ts`) calls
   `findSafeAlternatives(suspectItems, [product.id], 3)` with no `category`. Any product of any type
   that avoids the suspect ingredients qualifies. The comparison card
   (`performDifferentialAnalysis()`) has the same gap. Only the chat's 「代わりを探して」 reply
   (`findAlternatives()` in `src/lib/services/alternatives-service.ts`) passes a category.
2. **The candidates are just whatever happens to be cached.** `findSafeAlternatives()` only looks
   at products someone has already looked up: the in-memory list, refilled from KV. With few users
   that list is small. The SHISEIDO MEN lip balm is there because we used it for testing on
   2026-10-17. Nothing searches for products like the one being analysed. The chat reply runs web
   research when the cache is short, but the card never does.
3. **"Safe" is checked, "similar" is not.** A candidate only has to avoid the suspect ingredients
   and every moderate or high irritant. A lip balm easily passes for a sunscreen whose suspects are
   UV filters and ethanol. Ranking uses only 無香料 and アルコールフリー.
4. **The card claims more than the code checks.** The subtitle says
   「敏感肌でも使いやすい低刺激・無香料処方の厳選コスメ」, but nothing is curated and 無香料 isn't
   required.

## What the shop keys change

Rakuten Ichiba Item Search and Yahoo! Shopping itemSearch v3 are free (counted per minute, 1 call a
second per app ID) and return products that are **on sale now**, with genre, price, photo, JAN code
(Yahoo!) and affiliate links (Rakuten Affiliate, ValueCommerce). That fixes cause 2 better than web
research:

| | Web research (today) | Shop search (new) |
|---|---|---|
| Cost per search | about $0.01–0.03 (Web Search + Gemini page reads) | $0 |
| Same kind of product | by search words only | by shop genre (`genreId`, `genre_category_id`) |
| On sale, price, link | no | yes, with affiliate links |
| Full ingredient list | yes (read from the page) | **no structured field**; sometimes in the item text |

So the shops are the place to **find** candidates; ingredients still have to be **checked** before a
product gets the 「原因成分フリー」 badge. The code checks stay the only gate.

Rules that carry over from the [lineup feature](../walkthroughs/2026-10-15-shop-lineups.md):

- Search words are fixed words only (category, form, 「無香料」 etc.); nothing the user typed and no
  label text goes to a shop.
- Shop results are not stored anywhere shared (Rakuten terms, Article 10 (9)); names are shown as
  returned (Article 10 (7)); Rakuten links only through Rakuten Affiliate; the credits are shown.
- LINE Yahoo!'s storage terms are still unchecked, so Yahoo! results follow the same no-storage rule.

## Step 1: never suggest a different kind of product (small, ship first)

Unchanged by the keys.

- Work out the analysed product's category: use `product.category`; if it is `other`, infer it from
  the name with `categoryFromText()` (「UV」「日焼け止め」 → sunscreen). Pass it to
  `findSafeAlternatives()` from `analyzeProduct()`.
- In `performDifferentialAnalysis()`, use the most common category among the products that caused
  trouble, the same as `alternativeRequestFromRoutine()` (move `mostCommonCategory()` next to the
  analyzer).
- If the category is still unknown, show no alternatives. An empty section is better than an
  unrelated one.
- Card copy: replace the subtitle with what is actually checked, for example
  「同じ種類（日焼け止め）で、原因候補の成分と強い刺激成分を含まない商品」. Keep the 無香料 badge
  only where `fragranceFree` is true (already so).
- Tests: a sunscreen with suspects and a cached lip balm that avoids them must give no lip balm. A
  product of category `other` with 「UV」 in its name must match sunscreens. An unknown category
  must give an empty list.

Cost: none. User impact: fewer suggestions until step 3, but no wrong ones.

## Step 2: measure first (half a day, free)

Before building on shop data, measure how often the item text carries a usable ingredient list. A
local script (keys from `.dev.vars`, never printed) runs about 20 fixed queries: 7 categories ×
2–3 forms (e.g. 「日焼け止め ミスト」「日焼け止め ジェル」「化粧水 無香料」), on both shops, and
counts per category:

- items in the right genre, and sets/refills dropped by `NOT_SINGLE_ITEM`;
- Rakuten `itemCaption` and Yahoo! `description` that contain 「全成分」 or 「成分：」 and parse with
  `parseIngredientLabel()` into at least 8 ingredients, at least 80% of them known to the database;
- Yahoo! items with a JAN code that already match a saved product, or Open Beauty Facts.

Also look up the genre IDs once (Rakuten Genre Search API, Yahoo! category list) for the 7
categories and pin them in code with the date checked.

Output: a short table in this plan. It decides how much step 3 relies on item text (free) versus
page reads (paid). Nothing is stored; the script is not committed if it holds anything beyond
counts.

### Result (2026-10-18, 13 fixed queries × 30 items per shop)

| | Rakuten | Yahoo! |
|---|---|---|
| Items / single items (sets dropped) | 390 / 344 | 390 / 315 |
| Name gives the right kind (`productCategory`) | 319 (93%) | 288 (91%) |
| Item text has an ingredient heading | 210 (61%) | 10 (3%) |
| Parses into 8+ ingredients | 177 | 6 |
| ... and 80%+ rated by the database and rules | 35 (10%) | 0 |
| Text with two lists (「【変更前】」, sets) | 23 | 0 |
| JAN code | 0 | 256 (81%) |

- **Rakuten needs an `Origin` header.** Without one every call returns 403
  `REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING` (a `Referer` set from Node is dropped). With
  `Origin: https://cosmetantei.satoruchid.workers.dev` it works. `shop-apis.ts` sends neither, so
  Rakuten search and prices fail in production today.
- **Rakuten is the ingredient source, Yahoo! the JAN and price source.** Yahoo! descriptions almost
  never list ingredients.
- **Open Beauty Facts by JAN is no help:** 1 of 21 sampled Yahoo! JAN codes had ingredients.
- **The bottleneck is our ingredient database, not the shop text.** The 152 distinct parsed lists
  hold 911 distinct unrated names. Rating the most common ones lifts the lists that pass 80%:
  33 → 74 (top 50), 93 (top 100), 119 (top 200). Sunscreens fare worst: UV filters such as
  ジエチルアミノヒドロキシベンゾイル安息香酸ヘキシル, ビスエチルヘキシルオキシフェノールメトキシフェニルトリアジン
  and エチルヘキシルトリアゾン, and even 酸化チタン and 酸化亜鉛 as written in captions, are unrated.
- **Parsing needs a cleanup pass:** leading words such as 「・分量」「成分は予告なく変更…」「≫」 end up
  as ingredient names; captions with 「【変更前】」 hold old and new formulas.
- Genre IDs (most results in each): Rakuten 日焼け止め 503054, 化粧水 216307, 美容液 216348,
  クリーム 216424, 乳液 216387, 洗顔 405130, クレンジング 405100, パック 503020, リップ 405206;
  Yahoo! 46427, 1764, 1769, 1753, 1766, 48903, 48902, 1767, 5005.

What this changes for step 3: send `Origin` to Rakuten (a fix on its own); before step 3, add the
~100 most common unrated names to the ingredient database (free, reviewed by hand, sunscreen filters
first) or let the existing AI rating cover them; parse only the part after the last 「【変更後】」
and drop captions with two 「全成分」 blocks; skip Open Beauty Facts for shop JAN codes.

### Follow-up done the same day

- Rakuten calls send `Origin` (`RAKUTEN_API_ORIGIN`, `https://cosmetantei.app`). Checked live:
  `https://cosmetantei.app` and the workers.dev address pass; an unregistered origin gets 403
  `HTTP_REFERRER_NOT_ALLOWED`, so Rakuten checks the origin against the app's registered sites.
- Ingredient database: sourced entries for the 9 UV filters that were unrated (化粧品基準 別表第4 and
  EU Annex VI; 酸化チタン and 酸化亜鉛 as `safe` scatterers) and グリチルレチン酸ステアリル (CIR 2007);
  オレンジ油 and レモン油 as names of the citrus peel oils. Rules for the safe groups: minerals,
  fatty alcohols, emollient esters, plant oils, sugars, proteins, sterols and phospholipids,
  silicones, hydrocarbons and waxes, chelators, amino acids; essential oils as
  `moderate_irritant` (citrus peel oils `high_irritant`, as in the DB); preservatives and urea as
  `low_caution`. Look-alikes stay unrated: チオグリコール酸グリセリル, パラフィンスルホン酸Na,
  水酸化亜鉛. Dash variants (「−」 U+2212 etc.) are
  now stripped when names are compared (`PCA−Na`, `ポリシリコーン−15`). Test 93.
- Effect on the same 152 lists: **119 pass the 80% bar, up from 33**, with no AI call. The
  remaining unrated names are mostly actives (vitamin C derivatives, トラネキサム酸, アルブチン,
  エクトイン; for sourced entries or the AI rating later) and text that isn't an ingredient
  (「はれ」「かゆみ」「刺激」, warning sentences, 「1」), which step 3's reader must drop.

## Step 3: find candidates in the shops, check them in code

When step 1 finds fewer than 3, the card shows 「同じ種類で原因成分を含まない商品を探す」. A press
calls `/api/chat` with `action: 'find_alternatives'` and **only the product id**. The server works
out the category and the suspect ingredients from the product it holds. (It runs on a press, not on
every analysis, because the shop APIs allow about 1 call a second for the whole site.)

1. **Search the shops** (free, both shops in parallel, 30 items each): the category's genre ID plus
   fixed words, e.g. 「日焼け止め ミスト 無香料」, and 「ノンケミカル」 when the suspects include
   `uv_filter` ingredients. Drop sets, refills, out-of-stock items, the analysed product's own line,
   and duplicates (JAN code, `productIdentityKey()`).
2. **Check ingredients, cheapest source first:**
   1. a saved product with the same JAN code or identity key (already checked, free);
   2. the item text, read in three passes and used **for this reply only**, never cached
      (Rakuten Article 10 (9)); the card says 「販売ページの成分表示で確認」:
      - **cut** (code): the block after the last 「全成分」 or 「【変更後】」, ending at the first
        heading that isn't ingredients (使用方法, 使用上の注意, お肌に異常, 内容量, 区分,
        広告文責, ...); captions with two separate lists are skipped;
      - **parse and drop the obvious** (code): `parseIngredientLabel()`, then drop items that are
        sentences (「。」, verbs), numbers alone, or symptom words (はれ, かゆみ, 刺激, 赤み, 傷);
      - **filter with clef-flash** (Workers AI, $0.038 per million input tokens, about $0.00004 per
        list): one call per list, one question per remaining item, "is this an ingredient name
        on a full ingredient label?" (ingredient / other). Items Clef calls `other` with 75%+ are
        dropped. Clef sees only the item names, not the whole description. The call skips the AI
        Gateway cache and payload logs (no shop text kept anywhere), like calls with user text.
        If Clef is unavailable, the code-filtered list is used: leftover junk counts as unrated
        and pushes the list below the 80% bar, so the failure is "no alternative", never a
        wrong badge.
      - The real risk is the opposite: a cut that ends too early drops real ingredients, and a
        product could look free of a suspect it contains. So a list is used only when its cut
        ends at a known heading or at the end of the text, and only with 8 or more ingredients.
        Before shipping, evaluate on the step 2 queries: compare Clef's decisions with a hand
        check of 20 lists, and count how often each pass changes the result (as for the search
        filter on 2026-10-13);
   3. only for the top 3 still unchecked: the existing product lookup (JAN code for Yahoo!, name
      search otherwise), which reads the maker's or a shop's page with Gemini (paid, about $0.01 per
      product). Products read this way are saved as today, so the saved list grows with real
      products.
3. **Same gate as today**: none of the suspects, no moderate or high irritants, at least 80% of
   ingredients rated, same category.
4. **Show** up to 3 with photo, price (as returned), and shop links (Rakuten Affiliate, Yahoo! via
   ValueCommerce), plus the Rakuten and Yahoo! credits. The Amazon search link stays as a second
   button. The card heading drops 「Amazon」 and keeps 「PR」 because the links are affiliate links.

If neither shop key is set, both shops fail, or fewer than 3 pass, fall back to today's
`findAlternatives()` web research (changed 2026-10-19). The chat's 「代わりを探して」 uses the same steps, so both paths give the same answer.

Budget: paid page reads count against the per-client and per-network budgets and the AI rate
limits like every other paid call; a press with nothing left to check costs $0.

## Step 4: rank by how similar the product is

Within a category, sort by:

1. **Form**: ミスト・スプレー / ジェル / ミルク・乳液 / クリーム / スティック, read from the name with
   a fixed word list. Shop item names almost always say it, so no page read is needed.
2. **Use**: face or body, and for sunscreens the SPF/PA band and ウォータープルーフ (アスリズム is a
   sports, water-resistant line), also read from the name. Add `form`, `spf`, `pa` and
   `waterResistant` to the page-read schema for products read from pages; unknown values rank below
   known ones.
3. Then 無香料 and アルコールフリー, as today.

## Step 5: quality bar for a candidate

- At least 80% of the candidate's ingredients rated by the database or rules (not 「未評価」). The
  badge 「原因成分フリー」 says it has none of the suspects; it shouldn't stand on a list we mostly
  can't read.
- An ingredient list parsed from item text must look like one product's list: one 「全成分」 block,
  at least 8 ingredients, no second block (a set's caption lists several products).
- One product per product line (same name in several sizes or editions counts once).
- Never the analysed product itself under another id or JAN code.

## Not doing

- Ranking by price or popularity. Price is shown, not used to rank.
- Letting Gemini choose alternatives. Code checks stay the only gate, so a page, a shop listing or a
  model can't push a product.
- Ordering shops by affiliate rate.

## Done when

- ビオレUV アスリズム プロテクトミスト shows either sunscreens only (ideally mists or sprays) or no
  alternatives. It never shows a lip, cleanser or cream.
- With the shop keys set, a press finds same-category candidates at $0 when item text or saved
  products can be checked, and makes at most 3 paid page reads otherwise.
- Tests for steps 1, 3, 4 and 5 pass, with the shop APIs mocked; no shop result is written to KV or
  the product cache unless it came through a page read.
