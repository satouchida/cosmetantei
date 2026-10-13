# Japanese incidents: 加水分解コムギ and ロドデノール (2026-10-14)

Step 3 of the [Japan data plan](../plans/japan-ingredient-data.md#step-3-japan-specific-incidents).

## What changed

- **New database entry `rhododenol`** (ロドデノール, 4-(4-ヒドロキシフェニル)-2-ブタノール): high
  irritant.
  - Text: Kanebo's quasi-drug whitening ingredient, and the 2013-07-04 recall of 54 products
    from カネボウ化粧品, リサージ and エキップ after reports of 脱色素斑 where it was applied.
  - Advice: don't use leftover products. The JDA's third survey (964 patients still under care)
    found about 8 in 10 improved, but only 17% healed or nearly healed.
- **New database entry `hydrolyzed_wheat`** (加水分解コムギ, 加水分解コムギ末, Hydrolyzed Wheat
  Protein): low caution.
  - Text: the soap cases (「茶のしずく石鹸」 and others), the recall, and the two MHLW notices.
    It keeps the notice's hedge: sensitization 「否定できない」.
  - Why only low caution: the cases were 加水分解コムギ末 in soap, not every wheat protein. The
    warning for people with a wheat allergy comes from the wheat flag below.
- **Wheat-derived ingredients:**
  - Any ingredient with 「（小麦由来）」 (and its variants), or 小麦, コムギ, Triticum or wheat in its
    name (but not buckwheat), is flagged.
  - The card says 「🌾 小麦由来の成分です」, and the product gets a note listing them, with the advice
    from the notices (stop and see a doctor if itching or swelling appears).
  - The two MHLW sources are added to the card's references.
- **Names with the 2011 notice's annotation now match:** 「グリセリン（小麦由来）」 used to normalize
  to 「グリセリン小麦由来」 and match nothing. The shared normalizer now drops the annotation, so
  the rules and the 化粧品基準 matching benefit too.
- **加水分解コムギデンプン** (a starch) doesn't match the protein entry.

## Sources

See the [plan](../plans/japan-ingredient-data.md#step-3-japan-specific-incidents). All are MHLW
notices and pages or the JDA's committee documents. The text was extracted and checked locally.
The MHLW 2013 press pages on rhododenol no longer resolve, so the entry cites MHLW's 2013-11-12
summary as published by the Consumer Commission.

## Tests

Test 74 checks:
- label, quasi-drug and English names of both ingredients;
- that the annotation doesn't stop glycerin or BG from matching;
- what counts as wheat-derived (Triticum yes, buckwheat no);
- the product note and references;
- that the starch is excluded.

Test 55 checks the two entries' sources and review dates.

## Code review

`code-improver` checked every claim against the extracted sources and found nothing Critical or
High. Fixed:
- **Medium, the wheat text:**
  - it stated sensitization as fact, but the 2010 notice says it 「否定できない」 (can't be ruled
    out);
  - it added 「粘膜」, 「旧」, recall years and 「保湿・泡立ち」, none of which are in the sources.
- **Medium, the labelling sentence:** it read as a guarantee. The 2011 notice asks the industry,
  through the prefectures, to label wheat-derived ingredients. It also exempts names that already
  contain 小麦 or コムギ.
- **Medium, the annotation regex:** it was rebuilt on every call of the normalizer, a hot path,
  and it missed variants such as 「（小麦由来成分）」.
- **Medium, the risk level:** `hydrolyzed_wheat` moved from moderate irritant to low caution,
  for the reason above.
- **Low:**
  - the rhododenol advice now gives the survey's numbers and who was surveyed;
  - the product note no longer says "see a doctor before use", which the notices don't say;
  - duplicate names in the wheat note;
  - Triticum written in katakana;
  - the starch.

Declined: flagging グルテン. "Corn gluten" isn't wheat.
