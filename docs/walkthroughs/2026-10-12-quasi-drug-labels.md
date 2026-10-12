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

## Follow-up the same day: the known limits

The first version listed four limits. What changed for each:

| Limit | Now |
|---|---|
| A label whose only separator is 「・」 was split inside names | After splitting at 「・」 or 「/」, pieces are rejoined by the rules in JCIA's 医薬部外品簡略名作成ガイドライン (2006) §8-2, which says where 「・」 goes inside a name: between element symbols (「硫酸Al・K」), between copolymer parts (「アクリル酸アルキル・VA共重合体液」), and after POE/POP before the rest (「POE・POPラノリン」). A 「〜共重合体」 takes in up to four preceding monomer pieces (アクリル, メタクリル, スチレン, ビニル, マレイン, ウレタン, ジフェニルポリシロキサン, VA, VP, POE, POP, ブチレン). ジメチコン joins only when it comes right before the copolymer. Never taken in: glycols, glycerins, EDTA, and words common in standalone ingredients (シクロペンタシロキサン, エチレン/プロピレン surfactants, ピロリドンカルボン酸). 「〜クロスポリマー」 and 「〜コポリマー」 are cosmetic names and take nothing in; a bracketed name is already one piece. Also rejoined: 「PEG/PPG-14/7ジメチルエーテル」 (a mole number, not a locant like 「1,2-」) and the MCI/MI mixture. A standalone abbreviation (BG, PG, …) is never attached to POE/PEG. 「1,3-」 is now kept after 「・」 too. A label that uses 「、」 or newlines but has a piece with two or more 「・」 has that piece split the same way, so one stray newline doesn't turn a 「・」 list into one item |
| Old saved products kept the old splitting | Products the new parser makes carry `labelFormat: 2`. A saved Open Beauty Facts product without it is skipped when read from KV (the barcode cache and the verified-product list), so the next lookup fetches and parses it again. If Open Beauty Facts can't be reached, the saved product is still returned rather than lost, and no "not found" is cached. The verified list is rewritten once without the old products. The original text isn't saved, so the old pieces can't be repaired. Web-page products were never split by the old rules and are kept |
| Name list edition unchecked | Checked: the list JCIA links today is byte-identical to the one used, the 2008-03-25 edition (server date 2018-06-29) |
| Only our 35 entries got quasi-drug names | An extra exact-match pass compares names after applying the guideline's abbreviation rules: POE, POP, PEG, PPG, DPG, BG, PG, TEA, DEA, MEA, EDTA, PCA, ジメチコン; element names to symbols with ジ/二→2, トリ/三→3 (§2, §8-1); the natural 「L-」 dropped (§7-6). So 「POEラウリルエーテル硫酸Na」, 「ポリオキシエチレンラウリルエーテル硫酸Na」 and 「グリチルリチン酸二カリウム」 match without new aliases. Test 55 also fails if two entries share an alias in this form. Importing the JCIA list itself needs JCIA's permission (its site policy forbids copying or processing its data without it), so it isn't done |

### Code review of the follow-up

`code-improver` found two High issues, both confirmed and fixed:
- **Silicones swallowed:** the copolymer rule took in ordinary silicones. 「水・ジメチコン・シクロペンタシロキサン・ジメチコンクロスポリマー」 became one name. It now applies only to 「〜共重合体」, with a narrower monomer list.
- **One newline turned off 「・」 splitting:** a single newline or 「、」 stopped 「・」 splitting for the whole label. The old parser didn't have this problem.

Medium, all fixed:
- 「PEG・BG」 was joined;
- 「PEG-40/1,2-ヘキサンジオール」 was joined;
- an old barcode product was lost when the refetch failed, and the barcode was cached as "not found".

Low, fixed:
- the verified list was never rewritten without the old products;
- the alias `bha` on salicylic acid. On Japanese labels BHA is ブチルヒドロキシアニソール, per the guideline's abbreviation table. This mistake predates the change.

Low, declined: kanji numerals before an element name (「三…アルミニウム」) are read as a count. That can only cause a missed exact match, not a wrong one. The natural 「L-」 is dropped on both sides, as the guideline does.

Each fix has a case in test 56 or 58.

**Second pass** (allowed once after significant fixes):
- **Medium, fixed:** the POE/POP chain took in 「ブチレン」, so 「POE・POP・ブチレン・ジメチコン共重合体」 came out as two names. A prefix chain now links only abbreviations, and the copolymer takes the chain in.
- **Low, declined:** a bare 「PEG」 or 「POE」 in a 「・」-only list still joins the next name (「PEG・フェノキシエタノール」). A bare PEG/POE is rare on labels, and telling a product name from a standalone ingredient here would need a name list, which JCIA's policy rules out.

The re-split was confirmed to recurse at most one level.

### Citing JCIA by link

JCIA's site policy allows links in principle, and asks to be told when one is made. Copying its data
still needs permission. So the list is cited, not copied. When an analysis has quasi-drug notes, the
card links to JCIA's 「医薬部外品の成分表示名称リスト」 and 「医薬部外品の成分表示に係る基本方針」
(`QUASI_DRUG_LABEL_REFERENCES` in `ingredients-db.ts`, `labelReferences` on the result). Test 57
checks that both links go to www.jcia.org and that cosmetics get none.

### Known limits now

- **Unrecognised parts:** in a label separated only by 「・」, a copolymer whose parts aren't
  recognised as monomers, and a 「〜・〜混合物」, still split. Each piece is then rated on its own.
- **Missed abbreviations:** abbreviations outside the guideline (brand-specific short names) don't
  match.
- **Names outside the database:** quasi-drug names for ingredients outside our database still go to
  the rule-based fallback until the JCIA list can be used.

### Tests

- **55:** aliases must also be unique in the abbreviated form.
- **56:** nine 「・」/「/」 labels, from the guideline's examples and the cases above.
- **58:** abbreviated names match; DPG doesn't match PG.
- **60:** old Open Beauty Facts products are dropped from the saved list, and new ones carry the
  format marker.
