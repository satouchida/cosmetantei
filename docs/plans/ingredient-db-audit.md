# Plan: ingredient database audit and upkeep

Written 2026-10-12. Status: steps 1–5 done on 2026-10-12 ([walkthrough](../walkthroughs/2026-10-12-ingredient-db-audit.md)).

## Why

`src/lib/data/ingredients-db.ts` holds 35 hand-written entries. They decide risk levels in the
analysis, appear on the ingredient cards, and since phase 5
([redesign](gemini-role-redesign.md#phases-5-and-6-status-2026-10-12-done)) Gemini builds its
explanations of causes and ingredients from them. Today:
- they were written on 2026-09-19 and their facts have never been reviewed;
- no entry cites a source or records when it was last checked;
- the tests check name matching only, not facts;
- at least one claim is out of date: the limonene card says the EU requires 26 fragrance
  allergens on labels, but Regulation (EU) 2023/1545 expanded that list.

## Goal

Every entry's risk level and texts agree with a primary source, every entry says which sources
and when it was reviewed, and CI notices when that is missing or old.

## Sources, in order of preference

1. **Regulations:** EU Cosmetics Regulation 1223/2009 and its amendments on EUR-Lex (bans,
   limits, labelled allergens); Japan's 化粧品基準 (MHLW) and the 旧表示指定成分 list.
2. **Safety assessments:** SCCS opinions (EU), CIR reports (US).
3. **Dermatology references:** peer-reviewed reviews and patch-test data (e.g. ACDS Allergen of
   the Year), DermNet.

Not used: brand sites, blogs, marketing copy, and Gemini.

## Steps

1. **This plan**, and a row in `docs/PROGRESS.md`.
2. **Schema:** add `sources: { title: string; url: string }[]` and `reviewedAt` (ISO date) to
   `KnownIngredient`. Sources are for maintainers; the UI doesn't show them yet (phase 7 of the
   redesign adds 出典 links).
3. **Audit each entry** against the sources:
   - risk level and category;
   - `reasonJa` and `sensitiveSkinAdviceJa`: correct, current, no exaggeration
     (「劇的に」「絶対」), no brand names, no numbers without a source;
   - aliases: each alias must name the same ingredient (e.g. 甘草エキス is not
     dipotassium glycyrrhizate).

   Record every change with its reason and source in a separate walkthrough,
   `docs/walkthroughs/2026-10-12-ingredient-db-audit.md`.
4. **Tests:**
   - fail when an entry has no source or no `reviewedAt`;
   - warn (not fail) when `reviewedAt` is older than 12 months, so CI output shows what is due.
5. **Docs and commit:** this plan's status, `PROGRESS.md`, the walkthrough, then a commit.

## Rules for the texts

- General facts about the ingredient, not personal advice. Product-selection hints that already
  exist (「無香料の製品を選ぶ」) may stay when they follow directly from the facts.
- Concentrations and pH values only with a source.
- Japanese label names (化粧品表示名称) as `nameJa` where they exist.

## Out of scope (recorded for later)

- The rule-based explanations in `dynamic-ingredient-service.ts`, which cover ingredients not in
  this database. Audited on 2026-10-14
  ([walkthrough](../walkthroughs/2026-10-14-ingredient-explanations.md)); they still have no
  per-rule sources.
- Adding new ingredients.
- `comedogenicRating`: nothing reads it. It comes from old animal tests of low reliability; the
  audit removes values it can't source rather than defending them.

## Additions

- 2026-10-18: 9 UV filters (ジエチルアミノヒドロキシベンゾイル安息香酸ヘキシル, ビスエチルヘキシルオキシ
  フェノールメトキシフェニルトリアジン, エチルヘキシルトリアゾン, サリチル酸エチルヘキシル,
  t-ブチルメトキシジベンゾイルメタン, ポリシリコーン-15, ドロメトリゾールトリシロキサン, 酸化チタン,
  酸化亜鉛) from 化粧品基準 別表第4 and EU Annex VI; グリチルレチン酸ステアリル from the CIR 2007
  glycyrrhetinate report (Stearyl Glycyrrhetinate is named in it; conclusion: safe as used). The
  texts state only what these sources say; the limits per product type come from
  `cosmetic-standards-jp.ts` on the ingredient card. ([plan](alternative-recommendations.md))

- 2026-11-07: colorants. Four entries, matched by name pattern (`src/lib/data/tar-dyes.ts`):
  - **タール色素** (`tar_dye`): the 83 dyes of 医薬品等に使用することができるタール色素を定める省令
    (e-Gov, version of 2019-07-01). Rated 刺激の報告が少ない; as 表示指定成分 No. 140 they show as
    肌質により注意 and don't count toward the verdict. Before this they were unrated, which turned
    lipsticks and eyeshadows into 「評価できた成分が少ない」.
  - **赤色219号** (`brilliant_lake_red_r`) and **黄色204号** (`quinoline_yellow_ss`): やや注意, counted.
    Red 219: Sugai 1977 (22/38 positive, higher than other tar dyes), Kozuka 1979 and 1980 (the
    commercial dye held Sudan I, a strong allergen; purified dye a weak sensitizer). Yellow 204: the
    ordinance defines it as 2-(2-quinolyl)-1,3-indandione, the identity of D&C Yellow No. 11 in
    21 CFR 74.1711; case reports Björkner 1983, Komamura 1989, Sasseville 2009. Not rated higher:
    the reports are allergy in sensitized people (one era of impure commercial dye for Red 219),
    not evidence of irritation or of how often current products cause problems.
  - **CI numbers:** the 38 CI numbers in JCIA's *The List of JCIA Standards for Tar Colors*
    (2024-03-19, English summary pp.1–2) are read as the tar dye they name, so they get the same
    rating and 表示指定成分 note as the Japanese name (CI 15850 = 赤201, CI 15850:1 = 赤202,
    CI 15800:1 = 赤219). Other CI 10000–74999 numbers, except carotenoids 40800–40999 (Colour Index
    CICN groups), are `synthetic_dye_ci`: rated 刺激の報告が少ない and not raised, because which tar
    dye they are can't be told from the number. CI 47000 stays there: it is not in the JCIA table,
    and only chemical catalogs equate it with 黄色204号. Natural colorants (75000–75999) and
    inorganic pigments (77000–77999) are left to their own entries.
  - **JCIA standards** (read 2026-11-07 from the six PDFs on
    https://www.jcia.org/home/business/guideline/tarcolor.html and the quasi-drug label name list):
    - The 1988 standard limits 1-phenylazo-2-naphthol (Sudan I) to 5 ppm or less in 赤色219号 and
      seven other red dyes. Added to the 赤色219号 text. Red 219 stays やや注意: the purified dye was
      still a weak sensitizer (Kozuka 1980), and imported products are outside JCIA's standards.
    - JCIA members refrain from using 20 of the 83 dyes (1970, 2017, 2019), but JCIA says the 2017
      and 2019 additions concern worker safety and starting materials and do not mean an effect on
      consumers' health. Not used as a rating.
    - The documents don't mention allergy or pigmented dermatitis, Sudan I by that name, or use-site
      limits such as lips or eyes. The mucous-membrane rule for the 400 and 500 series comes from
      the ordinance itself (Article 3 and its table, Part 3).
    - The quasi-drug label name list (2008) gives the short names used in the pattern: 赤202, 黄4,
      橙205, 赤104(1), 褐201; a lake's short name is the parent dye's (黄4 for
      黄色4号アルミニウムレーキ).
  - Not used: the Nara Prefecture copy of the 2024 standard, which could not be fetched (HTTP 403);
    the JCIA PDF above replaces it.

## Next review

Due by 2027-10-12; test 55 warns in CI from then on. At each review: re-read the
EU and Japanese regulation entries for amendments, update `reviewedAt` only for entries actually
re-checked, and record changes in a new walkthrough.
