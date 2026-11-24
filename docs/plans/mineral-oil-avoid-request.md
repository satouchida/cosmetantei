# Plan: read 「鉱物油フリー」 requests, and say when a named ingredient can't be checked

Written 2026-11-24. Status: implemented 2026-11-24 (tests 223–225), not yet deployed. See [Result](#result). The owner decided that 流動イソパラフィン and similar
hydrocarbons are judged by AI (step 4), so steps 1 and the rules above change as noted.
From the full live check, day 2 ([results](full-live-check-results.md), B3 and finding 1).

These rules still hold:

- Code decides what is shown.
- The shops get only fixed words.
- There are no new paid calls, except step 4's (the owner's decision): one small Gemini question per hydrocarbon name,
  kept in KV for 30 days.
- Logs hold counts and fixed words only.

## What the live check showed

「鉱物油フリーのクリーム」 replied 「刺激になりやすい成分を含まないクリームを3件見つけました」. The `[alternatives]` line had
`avoid: 0`, `terms: []`. One of the 3 cards, セラヴィ モイスチャライジングクリーム, has ペトロラタム in its full list.

## Root cause

- `alternativeRequestFromText` (`alternatives-service.ts`) only avoids ingredients that `findIngredientsInText` finds.
  That function knows the ingredient DB (`ingredients-db.ts`) and the group words (`INGREDIENT_GROUP_WORDS`:
  アルコール, 紫外線吸収剤, ケミカル).
- 鉱物油 and its members (ミネラルオイル, ワセリン, ペトロラタム, パラフィン…) are in neither. The analyzer knows them
  only through a rule (`ingredient-rules.ts`, rule 17 「シリコーン・エモリエント油」), which rates them `safe` but is
  not used to read requests.
- So the request has no ingredient. Its kind is known (cream), so it becomes a plain "low-irritant cream" request.
- `summarizeAlternatives` then says 「刺激になりやすい成分を含まない…」 and nothing tells the user that 鉱物油 was not
  checked.

## Step 1. 鉱物油 as one ingredient entry (like パラベン類)

**Change** (`ingredients-db.ts`). Add one entry, shaped like `parabens` (one entry for a family, with the members as
aliases):

- `id: 'mineral_oil'`, `nameJa: '鉱物油（ミネラルオイル・ワセリン等）'`, `category: 'barrier_support'`,
  `riskLevel: 'safe'` (the same rating rule 17 gives today, so analysis results don't change).
- Aliases: 鉱物油, ミネラルオイル, 流動パラフィン, パラフィン, ワセリン, 白色ワセリン, ペトロラタム, マイクロクリスタリンワックス,
  セレシン, オゾケライト, mineral oil, paraffinum liquidum, petrolatum, paraffin, microcrystalline wax, ceresin,
  ozokerite.
- `reasonJa` and `sensitiveSkinAdviceJa` in plain words, with a public source and `reviewedAt`, like the other
  entries.

**Partial matches** (`ingredient-match.ts`, `aliasIsPartOf`). Aliases of 4 or more characters match inside longer
names. For this entry:

- 「パラフィンスルホン酸Na」 and other sulfonates or sulfates are cleansing agents, not oils. Exclude them the same way
  rule 17 does (`スルホン酸|硫酸|sulfon`).
- 「軽質流動イソパラフィン」「流動イソパラフィン」 contain 「パラフィン」 but are **not** matched by code (also excluded,
  `イソパラフィン|isoparaffin`). **Owner's decision: they are judged by AI** (step 4).
- Synthetic hydrocarbons (水添ポリイソブテン, イソドデカン, イソヘキサデカン…) don't match any alias. They are judged by
  AI too (step 4).

**What this changes elsewhere.** A new DB entry is read by every lookup, so check each reader:

- Analysis card: these ingredients now show the entry's text instead of rule 17's. The rating stays `safe`.
- `findIngredientsInText`: 「鉱物油って何？」 becomes an ingredient question with a 🔍 button, like other entries.
- Comparison: a `safe` culprit is already skipped as an alternative to avoid (`alternativeGateReason`), so
  comparisons don't start avoiding mineral oil.
- `INGREDIENT_GROUP_WORDS` doesn't change.

## Step 2. Search words for 鉱物油

**Change** (`alternatives-service.ts`):

- `shopTerms`: add 「鉱物油フリー」 for `mineral_oil`, the wording shops use in names.
- `queryTerm`: 「鉱物油不使用」, which the default `${short}不使用` already gives.

The full list is still checked by `findSafeAlternatives`, so a listing that says 鉱物油フリー but lists ワセリン is
dropped as `suspect`.

## Step 3. Say so when a named ingredient isn't known

**Change** (`alternatives-service.ts`, `chat-replies.ts`):

- When the request text has a 「○○フリー」「○○不使用」「○○が入っていない」「無○○」 phrase whose ○○ is not a known
  ingredient or group word, keep the word as `unknownAvoid`. It is held in the request only: not sent to the shops, not logged.
- `summarizeAlternatives` then starts with 「「○○」は成分データに無いため、含まれていないかを確かめていません。」 before the
  usual text, and the closing advice asks the user to check the package for it.
- The log gets a count only (`unknownAvoid: 1`).

This also covers 「シリコン不使用の下地」 in part. That request still has no kind (下地 is a makeup word), so it keeps
its current reply. Adding silicones and 下地 is a separate plan.

**Not changing.** No AI call to guess what ○○ means.

## Step 4. AI judges hydrocarbons the name doesn't settle (owner's decision)

Only when the request avoids `mineral_oil`.

**Which names.** A label name that is not the `mineral_oil` entry but looks like a hydrocarbon or wax whose origin
the name doesn't settle: イソパラフィン, (水添)ポリイソブテン, ポリブテン, イソドデカン, イソヘキサデカン, イソエイコサン,
アルカン, (水添)ポリデセン, オレフィンオリゴマー, ポリエチレン, 〜ワックス and the English forms. Acids, esters, salts,
glycols and sulfonates (`酸|グリコール|glycol|acid|sulf|スルホ`) are not hydrocarbons and are not asked about.

**The question** (`services/mineral-oil-judge.ts`, Gemini Decisions API `gemini-decision-1`, task `mineral_oil_judge`,
the same call the brand check uses as its second opinion): is this cosmetic ingredient 鉱物油, meaning a hydrocarbon
refined from petroleum (ミネラルオイル, 流動パラフィン, ワセリン, マイクロクリスタリンワックス, セレシン are)? The answer is a
probability: 0.7 or more is `mineral_oil`, 0.3 or less is `not_mineral_oil`, anything between is `unsure` (the brand
check's thresholds). The name goes in as a JSON string after the question. Nothing the AI writes is shown.

- Verdicts are kept per normalized name: in memory, and in KV (`mineral-oil:v1:<hash>`) for 30 days (`unsure` for
  1 day).
- Unjudged names go 20 to a call; at most 3 calls per request, none after a failed call. Each name is looked up
  once per request, and KV is still read after the calls are used up. Only saved products that could be shown are
  asked about (not excluded, verified, not a user's label).
- Names come only from saved products and shop listings the server read, never from the user's message. They must
  pass `isEvaluableIngredientName`, be 40 characters or fewer and have no hiragana (a seller's sentence is not
  sent). Names the DB already settles as 鉱物油, and plant or animal waxes named as such (ミツロウ, キャンデリラ,
  カルナウバ, ライス…), are not asked about. Items joined with 「・」「、」「/」 are split first.

**The check** (`alternative-gate.ts`, through `analyzer/mineral-oil.ts`). When `mineral_oil` is avoided, a product
with such a name is `suspect` unless the verdict is `not_mineral_oil`. No verdict (AI not configured, the cap
reached, a failure) and `unsure` count as 鉱物油: the reply promises the product is free of it, so an unconfirmed
name doesn't pass. The check itself stays synchronous; the verdicts are fetched first:

- `findAlternatives`: for the saved products of the kind, before each check (also after web research);
- `findShopAlternatives`: for each listing, before it is checked.

**The reply.** When `mineral_oil` is avoided and Gemini is configured, `summarizeAlternatives` adds 「鉱物油かどうかが成分名だけでは分からない成分
（イソパラフィンなど）は、AI が判定しています。AI の判定には誤りが含まれることがあります。」

## Tests

Use the next free test numbers.

- **Step 1:**
  - `findMatchingKnownIngredient` maps ミネラルオイル, ワセリン, 白色ワセリン, ペトロラタム, 流動パラフィン,
    マイクロクリスタリンワックス and the English names to `mineral_oil`;
  - not パラフィンスルホン酸Na, 水添ポリイソブテン, イソドデカン or セテアリルアルコール;
  - 「鉱物油フリーのクリーム」 gives a request that avoids `mineral_oil`, kind cream.
- **Step 1, gate:** `findSafeAlternatives` drops a cream whose list has ペトロラタム and keeps one without it.
- **Step 2:** `shopTerms` gives 「鉱物油フリー」.
- **Step 3:** 「シリコン不使用の化粧水」 gives `unknownAvoid` and the reply sentence. 「香料不使用の化粧水」 doesn't.
- **Step 4:** with faked Gemini answers, a cream with 流動イソパラフィン passes when the verdict is `not_mineral_oil` and
  is dropped for `mineral_oil`, `unsure` or no verdict; a verdict is read from KV without a new call; at most 3 calls
  per request; 酸・エステル・グリコール names aren't asked about; nothing is asked when 鉱物油 isn't avoided.
- **Unchanged results:** analysis of a seeded product with ワセリン keeps its rating.
- A mutation check for each step, the full gates (`tsc`, `eslint`, `npm test`) and a live check of
  「鉱物油フリーのクリーム」 (expect `avoid: 1`, `terms` with 鉱物油フリー, no card with mineral oil).

## Result

Implemented as above (tests 223–225; a mutation check for each rule, 11 in all, each makes a test fail).

- The DB entry changes only the 11 expected names among the 6,588 checked offline (ミネラルオイル, ワセリン,
  ペトロラタム, 流動パラフィン, マイクロクリスタリンワックス and their forms). Isoparaffins and パラフィンスルホン酸Na
  stay unmatched.
- The saved products (production snapshot) have 16 distinct names for the AI to judge, so a cold cache needs one
  call: 水添ポリイソブテン, 合成ワックス, (α-)オレフィンオリゴマー, ポリエチレン, テトラデセン, イソドデカン, ポリブテン,
  ポリイソブテン, 水添ポリデセン, イソヘキサデカン and the 流動イソパラフィン family.
- Offline (no Gemini), 「鉱物油フリーのクリーム」 drops 5 saved creams for clear 鉱物油 (セラヴィ, セタフィル, ニベア,
  ヴァセリン, 薬用バーム). The キュレル creams pass only when α-オレフィンオリゴマー is judged not 鉱物油.
- CPU, offline: the request takes 15 ms on the first run and 2 ms after; requests that don't avoid 鉱物油 are
  unchanged.
