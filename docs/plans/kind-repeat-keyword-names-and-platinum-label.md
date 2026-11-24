# Plan: cut a keyword list that repeats the kind, and a brand entry for プラチナレーベル

Written 2026-11-24. Status: implemented 2026-11-24 (tests 220–221), not yet deployed.
Follows the live check of `d7d779b` (Cloudflare version `a62a3a10`): five request searches that ask the
shops, with the `[alternatives]` log line. Earlier rounds:
[shop-paid-lookups-and-keyword-names.md](shop-paid-lookups-and-keyword-names.md),
[mineral-filter-terms-and-list-dedupe.md](mineral-filter-terms-and-list-dedupe.md).

These rules still hold:

- Code decides what is shown.
- The shops get only fixed words.
- There are no new paid calls.
- Logs hold counts and fixed words only.

## What the live check showed

All cards were correct: every full ingredient list was free of what the search avoided. 「香料が入っていない
泡洗顔」 showed two 楽天 cards with keyword lists in the name, and one with a wrong brand line:

| Shop name (楽天) | Card today |
|---|---|
| 【選べる 国内正規品】アクセーヌ ACSEINE リセット ウォッシュ 200ml 洗顔料 泡洗顔 弱アルカリ性 弱酸性 低刺激 無香料 アルコールフリー グリコール酸配合 … 1本/2本 | アクセーヌ / 「ACSEINE リセット ウォッシュ 洗顔料 泡洗顔 弱アルカリ性 … 1本/2本」 |
| CICA シカ クレンジング洗顔 200g プラチナレーベル ドウシシャ 洗顔料 クレンジングフォーム 皮脂 毛穴 黒ずみ | CICA / 「クレンジング洗顔 プラチナレーベル ドウシシャ 洗顔料 クレンジングフォーム 皮脂 毛穴 黒ずみ」 |

- **Keyword list.** The cut at the kind's plain name (「洗顔料」) is blocked when the next word is a kind or form
  word. The block keeps 「アネッサ UV 日焼け止め ジェル …」 whole, where 「ジェル」 continues the name. Here the
  next word (「泡洗顔」「クレンジングフォーム」) names the same kind again, which a name doesn't do.
- **No earlier word of the kind.** In the アクセーヌ name, 「ウォッシュ」 is not a kind word, so the rule's other
  condition (an earlier word names the same kind) also fails.
- **Brand.** プラチナレーベル (ドウシシャ) is not in the brand list, so the card's brand line is the first word,
  「CICA」 (an ingredient nickname).

## Step 1. A plain kind name followed by the same kind again starts a keyword list

**Change** (`listing-name.ts`, `withoutNameTail`, the plain-name cut). Let the plain word's kind be K.

- The next-word block stays for a form word, a word of another kind and a number variant (「ジェル」
  「クリーム」「II」). It no longer applies when the next word is of kind K (「洗顔料 泡洗顔」).
- The name counts as already given when an earlier word is of kind K (as now), or when the next word is of
  kind K and at least 2 words come before the plain word (brand and name, so 「ミノン 洗顔料 泡洗顔 …」 keeps
  its name).
- At least 3 keywords must still follow (unchanged).

For example:

- 「… ACSEINE リセット ウォッシュ 200ml 洗顔料 泡洗顔 弱アルカリ性 …」 →「ACSEINE リセット ウォッシュ」 (the size
  is shown next to the price);
- 「CICA シカ クレンジング洗顔 200g プラチナレーベル ドウシシャ 洗顔料 クレンジングフォーム 皮脂 毛穴 黒ずみ」 →
  「CICA シカ クレンジング洗顔 200g プラチナレーベル ドウシシャ」.

This applies to the card name and to the Amazon/Qoo10/Yahoo! words, since both use `withoutSearchTags`.

**Not changing.** 「ウォッシュ」 stays out of the kind words: the kind words are also used to read requests and
sort listings, so adding it changes much more than names.

## Step 2. プラチナレーベル in the brand list

**Change** (`brands-jp.ts`). Add `{ name: 'プラチナレーベル', aliases: ['Platinum Label'] }` under the
affordable brands. `brandOf` then finds it in the 楽天 name, and the card's brand line is 「プラチナレーベル」.

**Not changing.** No general rule that skips 「CICA」 as a first word. 「CICA method」 is a real brand, so the
word alone can't decide.

## Tests

Next number 220.

- 220 (step 1):
  - the two live names are cut, on the card and in the search words;
  - kept: 「アネッサ UV 日焼け止め ジェル …」, 「… ハトムギ化粧水 クリーム …」, 「… 化粧水 II …」 (test 217 still
    passes), a same-kind next word with fewer than 3 keywords after it, and a same-kind next word right after
    the brand (「ミノン 洗顔料 泡洗顔 敏感肌 低刺激 保湿」).
- 221 (step 2): `brandOf` gives 「プラチナレーベル」 for the live listing, and `listingCardLabels` shows it on the
  brand line.
- A mutation check for each step, the full gates, and a live check.

## Implementation notes

- Steps 1 and 2 as planned.
- Review (code-improver), fixed:
  - **Medium.** 「UVジェル」「UVミルク」 read as sunscreen, so 「ロート スキンアクア 日焼け止め UVジェル 無香料
    ウォータープルーフ 顔用」 would have been cut to 「ロート スキンアクア」. A next word that starts with 「UV」 is
    not a repeat of the kind; it is the form in the name, as before.
  - **Medium.** The repeated word itself counted toward the 3 keywords. It no longer does, so 「洗顔料 泡洗顔
    詰替 つめかえ用」 (2 words after the repeat) keeps its name. The CICA listing still has 3 (「皮脂 毛穴 黒ずみ」).
- Review, declined:
  - **Low.** The repeat check also matches longer words that contain a kind word (「化粧水 ローションタイプ」).
    No real name of that shape has come up; the 3-keyword rule still applies.
- Test 220 covers both fixes (the スキンアクア name, the 2-word tail). Each test fails with its step or fix
  taken out.
- Gates: `tsc`, `eslint`, `npm test` 221/221.
