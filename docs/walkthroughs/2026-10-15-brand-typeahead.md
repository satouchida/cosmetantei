# Brand-first type-ahead (2026-10-15)

Follows [type-ahead for Japanese products](2026-10-15-typeahead.md). That change could only find
products someone had already researched. A list of every product name would be very large, so the
owner chose to start from brands: recognise the brand in the query, then narrow to its products.

## Decisions (owner, 2026-10-15)

- **Brand list:** written by the app as a seed list, with readings. Brands of researched products
  are added automatically.
- **Each brand's products:** from the Rakuten / Yahoo! shopping APIs **once the keys arrive**. Until
  then a brand shows only the products already saved for it. No paid research per brand.

## What the user sees

- Typing 「しせ」 shows a brand chip **資生堂 しせいどう** above the product cards. Tapping it fills the
  input with 「資生堂 」, so the user keeps typing.
- 「キュレル 化粧水」, 「きゅれる 化粧水」 and 「キュレル化粧水」 show that brand's saved products whose name or
  category matches 化粧水.
- A brand with no saved products shows only its chip.

## Brand list (`src/lib/data/brands-jp.ts`)

155 brands sold in Japan, grouped by maker in comments. Each has:
- **`name`**, as the brand writes it in Japan;
- **`kana`**, when the reading differs from the name: kanji (資生堂 しせいどう, 雪肌精 せっきせい, 米肌
  まいはだ) and Latin names (SK-II エスケーツー, RMK, DHC, THREE);
- **`aliases`**: English spellings and other ways of writing it (Curel / Curél, KOSE / KOSÉ,
  エチュードハウス).

The list was written for the app, not copied from JCIA or cosmetic-info.jp (their policies forbid
copying); brand names and readings are facts. Test 81 checks there are no duplicates and every
reading is kana.

**Readings fix one of the type-ahead's limits.** Kanji can't be found from kana in product names
(じゅんしん won't find 潤浸), but a brand's reading is in the list, so しせいどう finds 資生堂.

## Matching (`src/lib/services/brand-suggest.ts`)

All keys go through `searchKey` (hiragana/katakana, half-width, accents, separators).

- **`suggestBrands`:** brands whose name, reading or alias starts with the query. An exact match
  comes first, then the seed list, then brands from saved products. Up to 5.
- **`resolveBrand`:** the brand the query starts with, and the rest.
  - **A brand written as several words** (「エスティ ローダー 化粧水」, 「Bobbi Brown リップ」, and what a
    tapped chip fills in): the longest run of leading words that is a brand.
  - Otherwise the first word: the longest key wins (「エスティローダー」 is エスティ ローダー, not エスト).
  - Japanese is written without spaces, so 「キュレル化粧水」 splits into キュレル + 化粧水. A key shorter
    than 4 characters splits only before kanji: 「ちふれ化粧水」 splits, 「スリーピングマスク」 is not THREE.
  - An English brand is not split in the middle of a word: 「estee」 is not est + ee.
  - Short Latin keys (2 letters, such as VT) only match a whole word.
  - Keys of one character are not used.
- **`brandProducts`:** the saved products of that brand, narrowed by the rest with
  `rankProducts`. With nothing after the brand, all of them, verified products first.
- **Which products belong to a brand:** the product's `brand` field equals one of the brand's keys,
  or contains one:
  - a Japanese key of 2+ characters may be anywhere in it (Japanese has no spaces);
  - a Latin key of 3+ letters must be whole words in it (「Curel キュレル」, 「Nivea,Beiersdorf」), so
    「est」 doesn't match 「Estée Lauder」 and 「pair」 doesn't match 「Repair」.

  A maker name such as 花王 also matches its brands' products when the brand field says 花王.
- **Brands not in the list:** each distinct `brand` field of a saved product that matches no listed
  brand becomes a brand. For a list such as 「A, B」 the first name is used.
- **Speed:** the route builds the brand index once per request. Each product's brand field is
  normalised once (`WeakMap`), and whether a brand field belongs to a listed brand is remembered
  per string.

## The route (`/api/products/search`)

The response is now `{ query, results, brands }`:
1. Load saved products from KV, as before.
2. `brands`: computed on every request, not cached.
3. **If the query starts with a brand and its saved products fill the limit:** return them, with no
   external call.
4. **Otherwise:** the brand's products first, then the usual search (saved products, then Open
   Beauty Facts). Only the usual search's results are cached (`search:v5`); the brand's saved
   products are read fresh every time, so a newly saved product appears at once.
5. **While typing a brand** (brands are suggested but the query is not yet a whole brand, such as
   「しせ」), Open Beauty Facts is not asked. 「しせ」 went from 4.2 s to 0.14 s.

### Where the shopping APIs go

When the keys arrive, step 3/4 is where a brand's lineup is fetched: a Rakuten or Yahoo! search for
the brand (and the rest of the query), cleaned into product names. The limit of one call per second
per app ID, shared by all users, means it should run only after a brand is resolved, never on
every keystroke, and be cached per brand (names only; the shop's results themselves are not
stored, per [shop prices](../plans/shop-prices.md)).

## Checks

- Test 81:
  - the list has no duplicates and kana readings;
  - suggestions by reading (しせ, せっき), romaji (curel), half-width kana, English (sk), and an
    exact name first;
  - `resolveBrand`: with a space, without one, the longest brand, not splitting 「estee」, no brand;
  - `brandProducts`: a brand field in English or with the maker, narrowing by name and by category,
    verified first;
  - a brand that is not in the list, from a saved product.
- Test 82, the route: brand chips while typing a brand with no Open Beauty Facts call, no brands
  for an empty query, and a product saved after the first search appearing despite the cache.
- `wrangler dev` (local KV with saved Curel and ちふれ products):

  | Query | Time | Brands | Products |
  |---|---|---|---|
  | しせ | 0.14 s | 資生堂 | none saved |
  | きゅ | 0.02 s | キュレル | 3 キュレル products |
  | きゅれる 化粧水 | 1.8 s | — | キュレル 化粧水 I, II, III |
  | キュレル化粧水 | 0.02 s | — | the same |
  | せっきせい | 0.29 s | 雪肌精 | none saved |
  | sk | 0.58 s | スキンアクア, SK-II, SKIN1004 | none saved |

## Tray

- Brand chips sit above the product cards, in a group labelled 「ブランドの候補」. Each chip's name for
  screen readers is 「〜の製品から探す」.
- Tapping a chip keeps the focus in the input, so the phone keyboard stays open.
- With chips but no products, the header says 「ブランドを選ぶと、そのブランドの製品に絞り込めます」.

## Code review

`code-improver` found three High issues, all fixed:
- **Brands written as two words never resolved.** Tapping 「エスティ ローダー」 filled the input but
  showed nothing, and skipped Open Beauty Facts. `resolveBrand` now tries runs of leading words.
- **Brand fields were matched by substring,** so 「est」 matched 「Estée Lauder」 and 「pair」 matched
  「Repair」. Latin keys now match whole words.
- **Cost per keystroke:** every product's brand was normalised once per listed brand, three times per
  request. Now once per product, with one index per request.

Medium, fixed:
- the route cached the brand's saved products for an hour; now it caches only the usual search;
- **data:**
  - 毛穴撫子 is read けあなでしこ (it said けあななでしこ);
  - 「デコルテ」 (a common word) is no longer an alias of コスメデコルテ;
  - ヒロインメイク is its own brand, not an alias of キスミー;
  - &honey no longer has the key 「honey」, because 「&」 is ignored in matching. It is listed as
    アンドハニー / and honey;
  - added ロート and イハダ;
  - noted that NIVEA is Beiersdorf's brand, sold in Japan by Nivea-Kao;
  - extended the maker comment that covers Collage;
- short katakana brands (THREE 「スリー」) no longer split 「スリーピングマスク」;
- tray: the header with only chips, a group role, chip names for screen readers, a larger touch
  target, and focus kept in the input.

Low, fixed: brand fields that list several names use the first; a first word of only punctuation.

Tests added: brands in two words, false matches on brand fields, the short-katakana split, no key
shared by two brands, and the route (test 82).

Declined:
- **Guarding against chips from an older query** (tapping 資生堂 while 「しせいどう 化粧水」 is typed but
  the chips still show 「しせ」's): replies are already aborted when the input changes, so this is
  limited to the 300 ms pause before the next request. Merging the typed rest into the chip would
  be wrong for brands of two words.
- **A message when a tapped brand has no saved products:** the chip stays visible, and the header
  explains it. Until the shopping APIs fill brand lineups, most brands will have none.

## Not done

- **Brand lineups from the shopping APIs** (above), when the keys arrive.
- **The chat's product search** doesn't use brand resolution. Chat messages are sentences
  (「資生堂の化粧水を調べて」), so the first-word rule doesn't fit them.
- **Keeping the list current:** new brands appear in suggestions once a product of theirs is
  researched, but only as written in that product. Review the seed list with the yearly ingredient
  review.
