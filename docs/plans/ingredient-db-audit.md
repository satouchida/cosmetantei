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
  this database. They have the same problem and should get the same treatment next.
- Adding new ingredients.
- `comedogenicRating`: nothing reads it. It comes from old animal tests of low reliability; the
  audit removes values it can't source rather than defending them.

## Next review

Due by 2027-10-12; test 55 warns in CI from then on. At each review: re-read the
EU and Japanese regulation entries for amendments, update `reviewedAt` only for entries actually
re-checked, and record changes in a new walkthrough.
