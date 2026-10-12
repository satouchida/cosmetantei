# Plan: ingredient data for the Japanese market

Written 2026-10-12. Status: step 4 done on 2026-10-12
([walkthrough](../walkthroughs/2026-10-12-quasi-drug-labels.md)), and its known limits fixed the same
day. Step 1 is partly done (abbreviation rules) and otherwise blocked on JCIA's permission. Steps 2,
3, 5 and 6 not started.

## Why

The analysis rates ingredients from a hand-written database of 35 entries
([audit](ingredient-db-audit.md)) plus rules for everything else. For Japanese products that
leaves three gaps:

- **Names.** Japanese labels use 化粧品表示名称 (cosmetics) and 医薬部外品の成分表示名称
  (quasi-drugs), not INCI. A name we don't recognise is rated 「未評価」, however well known the
  ingredient is.
- **Quasi-drugs (医薬部外品).** Their labels follow different rules from cosmetics: active
  ingredients are listed separately, the other ingredients need not be in order of amount, and
  trade-secret ingredients can be left out. Today the app ignores all of this.
- **Japan-only facts.** The regulations (化粧品基準) and incidents (wheat protein, rhododenol)
  that matter to Japanese users are in no foreign database.

## Considered and not used: CIRE (voix-sys/cire-api)

An English INCI scoring API (454 rules, 390 ingredients) suggested by the user on 2026-10-12.
Not integrated:
- no Japanese names;
- evidence is a label per rule (e.g. "Industry consensus") with no link or review date;
- includes pore-clogging and pregnancy categories we don't support;
- there is no LICENSE file in the repo;
- it's a paid external call on every analysis.

Ideas taken from it instead: INCI as the canonical key, pair rules across a routine (step 5),
and a coverage figure. Its ingredient list may later serve as a to-do list of names to add, never
as facts, and only with the owner's permission.

## Sources, in order of preference

1. **Regulations and notices:** MHLW 化粧品基準; MHLW and PMDA notices; the 1980 告示 for
   旧表示指定成分.
2. **Industry standards:** 日本化粧品工業会 (JCIA). The labelling standards for cosmetics and
   quasi-drugs, and the two name lists (化粧品の成分表示名称リスト, 医薬部外品の成分表示名称リスト).
3. **Safety assessments and dermatology references**, as in the audit plan.

Not used: brand sites, blogs, and Gemini.

## Steps

| # | Step | What | Status |
|---|---|---|---|
| 1 | Name bridge | Japanese label names ⇄ INCI, from the JCIA lists, including quasi-drug names | **partly done; the rest is blocked.** Done: matching abbreviated and full names (POE/ポリオキシエチレン, Na/ナトリウム, 2K/ジカリウム) by the rules of JCIA's 簡略名作成ガイドライン, without the list. Blocked: JCIA's [site policy](https://www.jcia.org/user/jcia/sitepolicy) says its data and PDFs may not be quoted, copied, reproduced or processed without permission, and asks users to contact JCIA first. Linking is allowed in principle (JCIA asks to be told about links), so the app cites the list by linking to it: a quasi-drug's analysis card links to the name list and the labelling policy. Importing the lists still needs permission. Until then, names are added one by one as aliases with a source, as in step 4 |
| 2 | 化粧品基準 rules | Banned (別表第1), restricted (第2) and approved-list (第3, 第4) facts as data, so a card can say "limited to X%" or "rinse-off only" | not started |
| 3 | Japan-specific incidents | Sourced entries for 加水分解コムギ and ロドデノール | not started |
| 4 | Quasi-drug labels | See below | **done 2026-10-12** |
| 5 | Pair rules across products | E.g. a retinoid with AHA/BHA; several fragrance allergens across a routine. Each rule needs a source | not started |
| 6 | 旧表示指定成分 | Find the 1980 告示 and add the flag back where it applies (open item from the audit) | not started |

Each step gets its own walkthrough in `docs/walkthroughs/` and a row in `docs/PROGRESS.md`.

## Step 4: quasi-drug labels

Source: JCIA, 医薬部外品の成分表示に係る日本化粧品工業連合会の基本方針 (2006-03-10). The points that
matter here:
- §1: listing all ingredients of a quasi-drug is the industry's voluntary standard, not a legal
  requirement;
- §3(2): a trade-secret ingredient may be left out and shown only as 「他 n成分」;
- §7: ingredients are shown in two groups, 「有効成分」 and 「その他の成分」, or marked with ※ and a
  legend;
- §8: the active ingredients follow the order in the product's approval. **The order of the
  other ingredients is the company's choice**;
- §9: an ingredient used both as an active and as an additive is listed in both groups.

For comparison, cosmetics (JCIA 化粧品の全成分表示の記載方法に関する自主基準, 2018) list ingredients in
order of amount, except that ingredients at 1% or less, and colourants, may be in any order.

Work:
1. **Parse labels.** A parser for both label styles (group headings, or ※ marks with a legend),
   「他 n成分」, and a leading 「全成分：」. Fix the splitting:
   - don't split 「1,3-ブチレングリコール」 at the comma;
   - don't split at 「・」 when the label uses 「、」 or commas, because quasi-drug names contain
     「・」 (「メチルクロロイソチアゾリノン・メチルイソチアゾリノン液」);
   - don't split at 「/」 inside brackets (「(アクリレーツ/アクリル酸アルキル(C10-30))クロスポリマー」).
2. **Use it everywhere a label is read:** Open Beauty Facts (search and barcode), and web pages
   (Gemini returns the active ingredients and the 医薬部外品 statement separately).
3. **Analyse the active ingredients too.** Today `activeIngredientsJa` is only displayed. An
   ingredient listed in both groups counts once.
4. **Say what the label can't tell us.** For a quasi-drug, the order of the other ingredients
   says nothing about amounts. 「他 n成分」 means n ingredients we can't rate.
5. **Fix order-based texts.** The ethanol card says the list is always in order of amount.
6. **Quasi-drug names for existing entries** from the JCIA quasi-drug name list (2008-03-25
   edition), e.g. パラオキシ安息香酸メチル, D-パントテニルアルコール,
   パラメトキシケイ皮酸2-エチルヘキシル.
7. **Stop ranking quasi-drugs higher as alternatives.** Being a quasi-drug means an active
   ingredient is approved for an effect; it says nothing about being gentle.
8. **Tests** for the parser, the analysis and the new names.

Out of scope for step 4: the full JCIA name lists (step 1).

Edition check (2026-10-12): the name list JCIA links today
(`…/ingredients/drugexplain/qdlnl.pdf`) is byte-identical to the copy used above. It is the
2008-03-25 edition, last modified on the server on 2018-06-29. JCIA says it will update the list on
its site but gives no date, so recheck at each review.
