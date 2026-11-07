# Search flexibility

How the chat's product-name search copes with the different ways people and pages write the same
product. Started 2026-11-07, after 「メイベリン　スーパーステイ」 found nothing even though research
had found the right products. The official names are written 「SPステイ …」.

## What the search understands

| Difference | Example | Where |
|---|---|---|
| Hiragana / katakana, full / half width, accents, spaces and brackets | きゅれる = キュレル, Curél = Curel | `searchKey` in `src/lib/search/product-match.ts` |
| ヴ spellings | ヴィニル = ビニル, ヴァ = バ, ヴ = ブ | `searchKey` |
| Brand spellings from the brand list | Maybelline / MAYBELLINE NEW YORK / メイベリン ニューヨーク = メイベリン | `aliases` in `src/lib/data/brands-jp.ts` |
| Category words | 「… リップ」 matches a product whose category is lip | `CATEGORY_SYNONYMS` |
| Per-brand abbreviations in product names | メイベリン: SPステイ = スーパーステイ = super stay | `src/lib/data/name-aliases.ts` |

Not folded on purpose: the long-vowel mark ー (ヴィニール ≠ ヴィニル), because it changes the
meaning of some words. Abbreviations apply to one brand only, because SP means スーパー only for
some brands (owner decision 2026-11-07).

## When nothing matches

In the chat, an answer must name the searched product. A different product of the same brand is
not an answer (the 2026-11-03 log: a rouge shown for 「…リキッド」).

When nothing matches, but the search names a brand and there are checked products of that brand,
the chat shows them as close matches. The reply says that no exact match was found and lists the
close products, so a different product is never presented as the one searched for.

## Finding new spellings

Each search that ends with no matching product logs one `[search-miss]` line. It holds the number
of researched products, the brand and name of up to three that were dropped as not cosmetics
(`notCosmetic`) or as not matching the search (`notNamed`), and the number of close matches shown.
The user's search words are not logged.

Review these lines from time to time. When a dropped product is the one that was searched for:

1. If the brand was written differently, add the spelling to `aliases` in `brands-jp.ts`.
2. If the product name uses a brand-specific abbreviation, add a row to `name-aliases.ts`.
3. Add the search and the product as a row in `tests/search-cases.ts`, so the fix can't quietly
   break later.
