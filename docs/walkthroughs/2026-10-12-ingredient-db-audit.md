# Walkthrough: ingredient database audit (2026-10-12)

What changed in `src/lib/data/ingredients-db.ts`, why, and on what source. The plan is
[`docs/plans/ingredient-db-audit.md`](../plans/ingredient-db-audit.md).

## How the audit was done

- **Regulations were read in the official text:**
  - EU regulations were read through the EU Publications Office, from the same documents EUR-Lex
    serves;
  - Japan's 化粧品基準 was read from MHLW's PDF (別表第3 and 第4).
- **Safety assessments and studies were checked at PubMed or publisher records,** from abstracts.
  Full texts were not read.
- **Secondary sources:** the ACDS "Allergen of the Year" years come from a Wikipedia list,
  checked against several news reports. A primary source would be better.
- Each entry now has `sources` and `reviewedAt: 2026-10-12`. Missing fields are a type error.
  Test 55 also fails on an impossible date, a duplicate id, or an alias on two entries, and warns
  in CI when an entry is more than 12 months old.

## Facts confirmed in the official texts

| Fact | Where |
|---|---|
| Linalool, geraniol, limonene, citral and benzyl alcohol are labelled fragrance allergens (above 0.001% leave-on, 0.01% rinse-off) | EU 1223/2009 Annex III |
| Lavender oil and orange, lemon and bergamot peel oils were added to that list. Tea tree oil was not | EU 2023/1545 Annex |
| Products not meeting 2023/1545 may be placed on the market until 31 July 2026, and made available until 31 July 2028 | EU 2023/1545 |
| MI is banned in leave-on products, and limited to 0.0015% in rinse-off products | EU 2016/1198, 2017/1224 |
| Phenoxyethanol max 1.0% | EU 1223/2009 Annex V; 化粧品基準 別表第3 |
| Japan: salicylic acid 0.20 g/100 g; parabens 1.0 total; MI 0.01 rinse-off and leave-on; the MCI/MI mixture rinse-off only; oxybenzone 5.0 leave-on; octinoxate 20 (8.0 on mucosa); octocrylene 10 | 化粧品基準 別表第3, 第4 |
| Furocoumarins under 1 mg/kg in sun protection and bronzing products | EU 1223/2009 Annex II, entry 358 |
| Vitamin A: 0.05% RE in body lotion, 0.3% RE in other products | EU 2024/996 |

## Changes, entry by entry

"Wording" means the claim was right but overstated, for example 「劇的に」「絶対」「トップクラス」. Those
words were removed.

### Risk level, category or alias changes (these affect analysis results)

| Entry | Change | Why |
|---|---|---|
| `isopropanol` | `high_irritant` → `moderate_irritant` | No source supports "extreme dryness". In a repeated-use study it was less well tolerated than ethanol, at the same order of irritation (Cartner 2017) |
| `propylene_glycol` | category `drying_alcohol` → `moisturizer` | PG is a humectant and solvent, not a drying alcohol. The risk level stays `moderate_irritant`: CIR calls it safe only "when formulated to be nonirritating", and it was the ACDS Allergen of the Year in 2018 |
| `methylisothiazolinone` | alias `kathon cg` moved to `methylchloroisothiazolinone` | Kathon CG is the MCI/MI mixture |
| `dipotassium_glycyrrhizate` | alias `甘草エキス` removed | Licorice extract is a different ingredient from the purified salt. **Side effect:** a label with 甘草エキス now falls to the rule-based fallback, which rates any 「〜エキス」 `low_caution`, and it no longer counts as a soothing ingredient. Giving the extract its own sourced entry is left for later |
| all entries | `comedogenicRating` removed, here, from the type and from `dynamic-ingredient-service.ts` | Nothing reads it, and no source was found for any value (they come from old animal tests) |

### Wrong or out-of-date claims fixed

| Entry | Before | After | Source |
|---|---|---|---|
| `limonene` | EU requires 26 allergens on labels | the 2023 amendment expanded the list to more than 80 | EU 2023/1545 |
| `niacinamide` | 10%+ causes 「ナイアシンフラッシュ」 | flushing comes from niacin (nicotinic acid). Niacinamide rarely causes it; some people find high concentrations irritating | CIR 2005; nicotinamide vs niacin review |
| `hyaluronic_acid` | 「1gで6リットルの水分」 | number removed (no source); CIR safety conclusion added | CIR 2009 |
| `salicylic_acid` | keep it to 「0.5%以下」 | Japanese cosmetics are capped at 0.2%; quasi-drugs may contain more | 化粧品基準 |
| `retinol` | start at 「0.1%以下」, once or twice a week | personal regimen removed; the EU limits given instead | EU 2024/996 |
| `glycolic_acid` | causes 炎症後色素沈着; lactic acid and PHA recommended | removed (no source). Added: increases sun sensitivity; CIR conditions (≤10%, pH ≥3.5); FDA advice on sun protection | FDA AHA page |
| `ethanol` | 「ラメラ構造を一時的に乱して」; avoid if in positions 1–5 | the mechanism claim is replaced by the reported effects (drying, stinging, irritation and contact dermatitis, worse on damaged skin). The ranking hint now just says the list runs from most to least | Lachenmeier 2008 |
| `parabens` | 旧表示指定成分 | removed (no primary list found); added that ACDS chose parabens as a "non-allergen" in 2019, plus the Japan and EU limits | ACDS; 化粧品基準; EU 358/2014 |
| `propylene_glycol` | 旧表示指定成分; recommends DPG, BG and propanediol instead | 旧表示指定 removed (same reason); the product alternatives were removed | CIR 2012; ACDS |
| `lavender_oil` | 「細胞毒性」 | replaced with oxidation and patch-test data, and its 2023 EU allergen listing | Acta Derm Venereol 2016; EU 2023/1545 |
| `tea_tree_oil` | Korean-cosmetics remark | SCCS 2025: moderate sensitiser, worse when degraded; 0.1% in face cream | SCCS 2025 |
| `citrus_oils` | phototoxicity for all citrus oils | phototoxicity limited to oils with furocoumarins (e.g. bergamot); added the 2023 allergen listing and the Annex II limit | EU 2023/1545, 1223/2009 |
| `benzyl_alcohol` | — | added: ACDS Allergen of the Year 2026; allergy is uncommon | Dermatitis 2026 |
| `methylisothiazolinone` | 「絶対避けるべき」 | EU ban stated; added that Japan still allows 0.01% | EU 2016/1198, 2017/1224; 化粧品基準 |
| `ethylhexyl_methoxycinnamate` | 「日本で最も汎用される」 | removed (no source); Japanese limit added | 化粧品基準 |
| `dipotassium_glycyrrhizate` | brand names (キュレル, IHADA); 「強力な」 | removed | CIR 2007 |
| `centella_asiatica` | 「韓国コスメで絶大な支持」 | removed; added that human clinical data are limited | Bylka 2014 |
| `ceramides` | 「劇的に強化」; nameJa and nameEn listed different types | wording; both now list NP, AP, EOP, NS | CIR 2020 |
| `butylene_glycol` | 「極めて低い」 | allergy is rare but reported | Contact Dermatitis 2020 |

### Confirmed with wording changes only

`fragrance`, `linalool`, `citral`, `geraniol`, `sodium_lauryl_sulfate`, `sodium_laureth_sulfate`,
`methylchloroisothiazolinone`, `phenoxyethanol`, `ascorbic_acid`, `oxybenzone`, `octocrylene`,
`allantoin`, `panthenol`, `squalane`, `glycerin`.

## Open points

- **Primary sources still missing:**
  - the 旧表示指定成分 list (1980 notice), so PG and parabens could be described as 旧表示指定
    again;
  - a CIR report for squalane and butylene glycol (current sources are a review and a case
    report);
  - the ACDS years, which come from a Wikipedia list.
- **Abstract-level checks:** the PubMed sources were checked from abstracts only.
- **甘草エキス** has no entry of its own (see the alias change above).
- **Not audited:** the rule-based explanations in `dynamic-ingredient-service.ts` (see the plan).
