# 表示指定成分 on ingredient cards (2026-10-14)

Step 6 of the [Japan data plan](../plans/japan-ingredient-data.md#step-6-表示指定成分). The
ingredient audit (2026-10-12) removed 「旧表示指定成分」 from the paraben and propylene glycol
entries because no primary list was found. This step finds the source and adds the flag back.

## Sources

- **医薬発第990号 (2000-09-29)**, on the Tokyo institute's notice list. It says:
  - 昭和55年厚生省告示第167号 (the 1980 告示) was repealed. For cosmetics it designated 102
    ingredients so that consumers, with information from their doctor, could avoid products that
    may cause allergies and other skin problems. Full ingredient labelling replaced it from
    2001-04-01.
  - For quasi-drugs, 平成12年厚生省告示第332号 keeps a list for the same purpose, and the
    ingredients are 「従前指定している成分と同様のもの」.
  - Its 別添4 is the scanned 告示第332号.
- **The list as text:** Kanagawa's 「表示・添付文書等チェックリスト（医薬部外品）」, 参考資料:
  - ① the 告示 list (人体に直接使用されるもの, 140 items, as amended by 平成21年告示第29号);
  - ② 薬食発第0307001号 (2007), the names a quasi-drug label may use instead (「PG」, 「メチルパラベン」,
    「EDTA-2Na」, 「BHT」 …).

  The scan in 医薬発第990号 has the same items, numbered one lower before the 2009 amendment.
- No official copy of the 1980 list itself was found, so the app does not say an ingredient
  was 「旧表示指定」. It says the ingredient is designated for quasi-drugs, and that cosmetics had a
  list for the same purpose until 2001.
- 告示 and 通知 are not copyrighted (著作権法13条).

## What the user sees

An ingredient on the list gets one line on its card, on cosmetics and quasi-drugs alike:

> 🏷️ 表示指定成分（告示第332号の90「パラオキシ安息香酸エステル」）：医薬部外品では、アレルギーなどの
> 皮膚障害を起こすおそれのある製品を、医師からの情報をもとに使う人が避けられるよう、名前の表示が
> 義務付けられている成分です。化粧品にも1980年から2001年3月まで同じ目的の指定（いわゆる旧表示指定成分）
> があり、全成分表示に替わって廃止されました。載っていることは、誰にでも肌トラブルを起こすという意味では
> ありません。肌に合わなかったことがある成分なら、避ける目安になります。 成分の一覧 通知

There are two links:
- 「成分の一覧」 goes to the Kanagawa checklist, which shows the numbers after the 2009 amendment;
- 「通知」 goes to 医薬発第990号.

It does not change the rating. Being on the list says what the 2000 notice says, not how often
the ingredient causes reactions; ratings stay with the ingredient database and its sources.

The product summary for a 「warning」 product no longer says 「旧表示指定成分」. It was never
computed from the list.

## Data and matching

`src/lib/data/labeling-designated-jp.ts` has 140 entries, with these names for each:
- the 告示 name;
- the aliases from the 2007 notice;
- INCI and cosmetic label names only where they are surely the same substance.

Groups are matched by pattern on the normalised name:
- 及びその塩類: salt suffixes only, so サリチル酸ベンジル and 安息香酸ベンジル don't match;
- parabens;
- ラウリル硫酸塩類, ラウレス硫酸塩類;
- PEG lanolin, ラネス-n;
- tar dyes: every dye in the 省令's 別表 is named like 赤色202号.

`src/lib/analyzer/jp-designated.ts` matches labels:
- The 告示 writes locants as 「二・四―」 and labels write 「2,4-」. The key turns kanji digits into
  numbers and drops commas, primes, brackets and dashes, then uses the same abbreviations as
  the other matchers (ナトリウム→Na …).
- PEG: only the names in the alias table (PEG-4, 6, 8, 12 and ポリエチレングリコール200–600), not
  every PEG under molecular weight 600, and not PEG derivatives.
- Esters of PABA only; ジメチルPABA is a different substance.
- **Names that match only on quasi-drug labels:** the 告示 means the dl-α form, but on a
  cosmetic label these names also cover natural d-α:
  - トコフェロール and ビタミンE;
  - 酢酸トコフェロール and its aliases.

  アミノフェノール is also quasi-drug only.
- The number in 「ポリエチレングリコール400」 is the average molecular weight. In INCI 「PEG-400」 it is
  the number of ethylene oxide units, which makes a large polymer, so the two are kept apart.

## Tests

Test 77 checks:
- 140 entries numbered 1–140, and no name used by two entries;
- label names, aliases, INCI and the 告示's own spelling (「塩酸二・四―ジアミノフェノキシエタノール」);
- names that must not match: benzyl esters, PEG-100 and PEG-10 dimethicone, other
  glutamates, ジメチルPABA, 赤ワインエキス, PABA itself;
- the quasi-drug-only names;
- the card line, on a cosmetic and a quasi-drug.

## Not done

- **Insecticides and other products not used on the body** (the 告示's second part).
- **Amendments after 平成21年:** the Kanagawa checklist is undated. Added to Watch in PROGRESS.
  The owner found four later government documents. None amends 告示第332号 or 薬食発第0307001号:
  - 医薬部外品原料規格2021 (PMDA 000240227.pdf): the raw-material specifications. Its "332" matches
    are page numbers and test values.
    - 124 of the 140 entries have a name in it, spelled as in the data (「2,5-」 forms).
    - The rest are groups matched by pattern, or ingredients it doesn't list (DMDM hydantoin,
      imidazolidinyl urea, uricase, thiram, チオ乳酸塩). They were not renamed.

    The 2007 alias notice was issued because the 2006 edition renamed raw materials, so this is
    the check for new names.
  - 化粧品基準 (MHLW 000491511.pdf), already used in step 2.
  - 平成6年厚生省告示第194号 (MHLW 000500876.pdf, amended to 2017): the quasi-drugs that prefectures
    approve.
  - 薬生発0328第10号 (2017): the approval standard for vitamin supplements.

## Code review

`code-improver` checked all 140 entries and the aliases against the source text. All numbers
and 告示 names match. It found nothing Critical or High. Fixed:
- **Medium:**
  - The tar-dye pattern missed 「赤色104号(1)」, 「黄色202号の(1)」 and 「Ext.紫201号」.
  - The cosmetic 「酢酸トコフェロール」 was flagged, although like トコフェロール it can be d-α.
    Its aliases now match on quasi-drugs only.
- **Low:**
  - 「PEG-200」 to 「PEG-600」 matched the molecular-weight names. This is fixed in the key.
  - The card now links to the list, which has the numbering, and adds 「誰にでも肌トラブルを起こすという
    意味ではありません」.
  - Added names: セチルアルコール, トラガカントガム, the INCI names of TEA, DEA, MEA, BHT and BHA,
    and sodium laureth-n sulfate.
  - The pattern entries are filtered once, so each ingredient is not checked against all 140.

Declined:
- **Dropping 「1980年から」:** 医薬発第990号 dates the 告示 「昭和55年9月」, which is 1980.
- **Adding ノニル酸ワニリルアミド:** the spelling couldn't be checked without the JCIA list.

