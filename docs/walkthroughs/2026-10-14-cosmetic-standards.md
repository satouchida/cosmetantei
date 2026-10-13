# 化粧品基準 on ingredient cards (2026-10-14)

Step 2 of the [Japan data plan](../plans/japan-ingredient-data.md#step-2-化粧品基準). The owner
gave the sources: the MHLW cosmetics page, the Tokyo institute's notice list, 医薬部外品原料規格2021
and the 医薬部外品添加物リスト.

## What the user sees

- **Ingredient card.** An ingredient that is in a 別表 table gets one line. It names the table
  and the 告示 entry, gives the limit per 100 g for each product type, and links to the 告示.
  Example for クロルフェネシン:
  > 日本の化粧品基準（別表第3の2「クロルフェネシン」）：防腐剤として配合するときは、洗い流す化粧品は
  > 100g中0.3gまで、洗い流さない化粧品は100g中0.3gまで、粘膜に使用されることがある化粧品は配合不可。
  > 配合量は成分表示に書かれないため、上限の範囲内かは表示からはわかりません。
- **Product notes** (cosmetics only):
  - 別表第1 ingredients: 「化粧品への配合が禁止されている成分」. Examples are ホウ酸 and
    メタノール. The note adds that foreign products follow their own country's rules.
  - Ingredients not allowed for the product's type, such as MCI or DMDM hydantoin in a leave-on
    cream, or sodium lauroyl sarcosinate in a leave-on product.
- **Quasi-drugs** get none of this, because the 化粧品基準 does not apply to them.
- The 告示 joins the card's references.

## Data

`src/lib/data/cosmetic-standards-jp.ts` holds all 130 entries:

| Table | Entries |
|---|---|
| 別表第1 | 30 |
| 別表第2の1, 2の2, 2の3 | 4, 11, 3 |
| 別表第3の1, 3の2 | 16, 32 |
| 別表第4の1, 4の2 | 6, 28 |

- The text was extracted with PDFKit, and the columns were read from page images, because a
  blank cell means "banned for this type". Only DMDM hydantoin, the MCI/MI solution and
  imidazolidinyl urea are rinse-off only. Every other blank is in the mucosa column.
- Names to match come from the 告示, the English edition and common label/INCI names. Groups
  (parabens, 感光素, mercury, cadmium, strontium, selenium, bismuth except the oxychloride) are
  matched by pattern.
- A 告示 is not protected by copyright (著作権法13条2号).

## Decisions

- **Lip products get no product type.** Neither the 告示 nor the 2021 Q&A says whether they are
  「粘膜に使用されることがある化粧品」, so the app doesn't guess. Their cards still list every column.
- **Wipe-off cleansers get no type either:** クレンジングウォーター, 拭き取り and sheets. A
  `cleanser` is otherwise rinse-off.
- **Preservatives and UV filters:** the card says "when used as a preservative / UV filter".
  The 告示 (§4) governs those tables by purpose.
- **Head-only rows:** cysteamine HCl and the aminoether antihistamines show their conditions
  only. The product categories can't tell a scalp product from a face product.
- Not used, and why:
  - 医薬部外品原料規格2021: purity specifications for raw materials.
  - 添加物リスト: limits for quasi-drug additives. Labels don't give amounts, and the 化粧品基準
    does not apply to quasi-drugs.

## Tests

Test 73 checks:
- the entry count of each table, and spot values against the 告示;
- that no name is used by two entries;
- label names, including abbreviated forms (ピリチオンZn), and names that must not match
  (オキシ塩化ビスマス, サリチル酸ベンジル);
- the product types, including wipe-off cleansers and lip products;
- that quasi-drugs get no notes.

## Code review

`code-improver` checked every value and 告示 name in the data file against the 告示 text and
found them all correct. It found no label name mapped to the wrong entry, and nothing Critical
or High. Fixed:
- **Medium:** abbreviated label names (ピリチオンZn, …Na) didn't match entries written in full.
  The shared name module now abbreviates the data names too. `abbreviateIngredientName` moved
  there from the analyzer, so `jp-standards` doesn't import the analyzer.
- **Medium:** wipe-off and water-type cleansers were treated as rinse-off.
- **Low:**
  - other spellings of bismuth oxychloride, the only risk of a false "禁止";
  - the head-only rows, above;
  - missing spellings: o-シメン-5-オール, ジフェンヒドラミンHCl, thianthol;
  - the word order of the "not allowed" sentence;
  - a header comment that cited an amendment the PDF itself doesn't show.

Kept as is:
- **ホルムアルデヒド matching ホルマリン:** the 告示 says ホルマリン, its water solution, so
  this is recorded in a comment.
- **"抗ヒスタミン剤":** the text extraction dropped 剤, but the page image shows it.
