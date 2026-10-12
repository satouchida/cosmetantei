# Walkthrough: quasi-drug labels (2026-10-12)

Step 4 of [the Japanese-market data plan](../plans/japan-ingredient-data.md#step-4-quasi-drug-labels).
What changed, why, and on what source.

## Sources

| Source | Used for |
|---|---|
| JCIA, 医薬部外品の成分表示に係る日本化粧品工業連合会の基本方針, 2006-03-10 ([PDF](https://www.jcia.org/user/common/download/business/guideline/ingredientlabelling/20060310_IngredientLabelling_Standard-2.pdf)) | Quasi-drug label rules: §3(2) 「他 n成分」, §7 the two groups or ※ marks, §8 order of the other ingredients is the company's choice, §9 an ingredient listed in both groups |
| JCIA, 化粧品の全成分表示の記載方法に関する自主基準, 2018-07-31 ([PDF](https://www.jcia.org/user/common/download/business/guideline/ingredientlabelling/20180731_IngredientLabelling_Standard-3.pdf)) | Cosmetics order: by amount, ingredients at 1% or less and colourants in any order |
| JCIA, 医薬部外品の成分表示名称リスト, 2008-03-25 edition ([PDF](https://www.jcia.org/user/common/download/business/ingredients/qdlnl.pdf)) | Official quasi-drug names for existing entries |

The 2006 policy PDF is a scan. It was read from rendered page images.

## What the app did before

- **Splitting:** labels were split at 「,」「、」「・」「/」 and newlines.
  - 「1,3-ブチレングリコール」 became 「1」 and 「3-ブチレングリコール」, so the 「1」 counted as an
    unrated ingredient.
  - 「メチルクロロイソチアゾリノン・メチルイソチアゾリノン液」 became two names.
  - 「(アクリレーツ/アクリル酸アルキル(C10-30))クロスポリマー」 was split inside the brackets.
- **Quasi-drug labels weren't recognised.** 「有効成分：」 headings stayed glued to the first name,
  「他3成分」 was read as an ingredient name, and ※ marks stayed on the names.
- **Active ingredients weren't analysed.** `activeIngredientsJa` was only displayed.
- **The ethanol card said every list is in order of amount.** For quasi-drugs that isn't true.
- **Alternative ranking:** quasi-drugs ranked higher, as if being a quasi-drug meant gentler.

## Changes

| Area | Change | File |
|---|---|---|
| Parser | New `parseIngredientLabel` and `splitIngredientList`. They handle group headings (also 「※有効成分:」), ※/* marks with a legend (「※印は有効成分」「※印の成分は有効成分です」), 「他 n成分」 (capped at 999), 「[医薬部外品]」 (not 「医薬部外品ではありません」), and a leading 「全成分：」. A heading counts only at the start, after a separator or in brackets. Splitting doesn't break inside brackets; an unclosed bracket falls back to ignoring brackets; 「<」「>」 aren't brackets. A comma is kept only as a locant (「1,3-」「1,2,6-」), so 「ポリソルベート80,1,2-ヘキサンジオール」 still splits. 「・」 and 「/」 split only when the label has no 「、」, comma, 「;」 or newline. Lists are capped at the server's own validation limits (shared `LABEL_LIMITS`) | `src/lib/analyzer/label-parser.ts` |
| Open Beauty Facts | Search and barcode lookups use the parser and keep the quasi-drug fields, but only when the label also lists other ingredients (actives alone don't make a full label) | `live-cosmetics-service.ts`, `search-barcode-service.ts` |
| Web pages | Gemini also returns `activeIngredients` and `quasiDrug`. Both of its lists are re-parsed one name per line, so leftover marks, headings and 「他 n成分」 are handled. At most 10 actives. The facts cache key is now `webfacts:v2`, so old entries without actives aren't reused | `web-research.ts` |
| Analysis | `labelIngredients()` = actives first, then the other ingredients, each name once (§9 allows one ingredient in both groups). Used by single analysis, cause comparison and alternatives | `ingredient-analyzer.ts` |
| Notes | A quasi-drug gets 「「その他の成分」の記載順は配合量の多い順とは限りません」. 「他 n成分」 adds a note, and the summary says those n can't be rated. They also count towards 「判定できません」 when half or more of the ingredients are unrated | `ingredient-analyzer.ts`, `IngredientAnalysisCard.tsx` |
| Card | 「有効成分」 tag on active ingredients | `IngredientAnalysisCard.tsx` |
| Ranking | Being a quasi-drug no longer ranks an alternative higher. It means an active ingredient is approved for an effect, not that the product is gentle | `ingredient-analyzer.ts` |
| Validation | Products sent by the browser: `activeIngredientsJa` at most 30 names of 200 characters, `isQuasiDrug` boolean, `undisclosedIngredientCount` 0–999 | `validation.ts` |

## Ingredient database changes

`reviewedAt` stays 2026-10-12. Each changed entry gained a JCIA source.

| Entry | Change |
|---|---|
| `ethanol` | Advice: cosmetics list by amount (1% or less and colourants in any order). The order of a quasi-drug's 「その他の成分」 says nothing about amounts. Sources: the two JCIA standards |
| `parabens` | + パラオキシ安息香酸メチル, エチル, プロピル, ブチル |
| `panthenol` | + D-パントテニルアルコール, DL-パントテニルアルコール |
| `ethylhexyl_methoxycinnamate` | + パラメトキシケイ皮酸2-エチルヘキシル, パラメトキシケイ皮酸エチルヘキシル, パラメトキシケイ皮酸オクチル |
| `sodium_laureth_sulfate` | + ポリオキシエチレンラウリルエーテル硫酸ナトリウム |
| `methylchloroisothiazolinone` | + メチルクロロイソチアゾリノン・メチルイソチアゾリノン液 (the mixture, as with Kathon CG) |
| `hyaluronic_acid` | + ヒアルロン酸ナトリウム (the list has grades (1)–(3), matched by substring) |
| `retinol` | + 酢酸レチノール, ビタミンA油 (the entry already covers retinyl palmitate; EU 2024/996 covers the esters too) |
| `centella_asiatica` | + センテラエキス |

Already matched before (checked by test 58): 濃グリセリン, 1,3-ブチレングリコール, ニコチン酸アミド,
グリチルリチン酸ジカリウム, ラウリル硫酸ナトリウム, プロピレングリコール, エタノール, 無水エタノール.

## Tests

- **56:** both quasi-drug label styles, 「他 n成分」, and names containing 「,」「・」「/」.
- **57:** actives are analysed; an ingredient in both groups counts once; the notes appear; actives
  can be a cause in the comparison; cosmetics get no notes.
- **58:** quasi-drug names match the existing entries.
- **59:** web research moves ※-marked names to the actives and reads 「他 n成分」; the prompt asks
  for both fields.

## Code review

`code-improver` found no Critical or High issues. All seven findings were checked against the code
and applied, each with a test in 56:

- **Medium:** the digit-comma rule merged tight lists (「…80,1,2-…」, 「CI 77891,77492」); an unclosed
  bracket swallowed the rest of the list; Gemini's `activeIngredients` skipped the mark and heading
  cleanup; parser output could exceed the server's own validation limits, failing the round-trip
  from the browser; the legend pattern missed common phrasings.
- **Low:** 「医薬部外品ではありません」 set the quasi-drug flag; a label with actives only got
  analysed as if complete.

No second review pass: the fixes are local to the parser and covered by the new test cases.

## Known limits

- **One-name labels:** a label whose only separator is 「・」 is split there, even inside a single
  name. No separator rule can tell those apart.
- **Old saved products:** products already saved in KV (the verified-product list) keep their old
  splitting until they are looked up again.
- **Name list edition:** the JCIA quasi-drug name list used is the 2008 edition linked from JCIA's
  site. Whether a newer edition exists wasn't checked (plan, out of scope).
- **Only existing entries:** only our 35 entries got quasi-drug names. Other quasi-drug names still
  fall to the rule-based fallback; that is step 1.
