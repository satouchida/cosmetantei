# Pair rules across products (2026-10-14)

Step 5 of the [Japan data plan](../plans/japan-ingredient-data.md#step-5-pair-rules-across-products).
The rules and their sources are in the plan.

## What the user sees

In the comparison of products that caused trouble, a new section, 「一緒に使っていた場合の注意」,
lists any of three findings. Each gives its products, ingredients and sources:
- **レチノール類とサリチル酸などの重ね使い:** retinol or retinal in one product, and salicylic acid,
  sulfur or resorcinol in another. The text says the US label is about the drug tretinoin, which
  is not the same as cosmetic retinol.
- **角質に働く成分の重ね使い:** exfoliants in two or more products. The acne-drug rule is cited
  only when salicylic acid, sulfur or resorcinol is involved. The FDA sun note is added only when
  an AHA is.
- **香料成分の重なり:** fragrance or essential-oil ingredients in two or more products, with the
  SCCS point that the total amount on the same skin matters.

A product counts once even if it was added twice. Ingredients inside a single product never
make a pair.

## Code

- `src/lib/analyzer/pair-rules.ts`: the rules. Ingredients are resolved by the database, then
  the rules, in the same way as the analysis.
- `performDifferentialAnalysis` adds `pairFindings`. `DifferentialResultCard` shows them, with
  headings and source links.

## Tests

Test 75 checks:
- each rule, and which sources it cites;
- that retinyl palmitate is not a retinoid here;
- that the AHA sun note survives when the retinoid rule fires;
- that a single product or a duplicate product doesn't make a pair.

## Code review

`code-improver` found 2 High, 3 Medium and some Low issues. All fixed:
- **High, the wording:**
  - the retinoid text applied a drug label to cosmetic retinol;
  - the overlap text cited the acne-drug rule even for retinol or AHA only.
  Both now say what each source covers, and give advice rather than orders.
- **High, the retinoid group:** it included retinyl palmitate, a common minor vitamin-A
  ingredient. It is now retinol and retinal only.
- **Medium:**
  - the retinoid rule hid the AHA sun note;
  - AHA was detected from a display string, and included PHAs. It is now matched by name:
    glycolic and mandelic acid;
  - duplicate products were counted twice.
- **Low:**
  - the section has headings for screen readers;
  - the source text is less faint;
  - long ingredient lists are capped at 8.

Not done: caching ingredient lookups shared with the culprit loop. The comparison only covers a
few products.
