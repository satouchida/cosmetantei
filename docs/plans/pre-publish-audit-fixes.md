# Fixing the pre-publish legal audit findings

Written 2026-10-23. Status: steps 1 and 3–8 implemented 2026-10-23 (not committed); step 2 needs no change.
Tests 120 and 121, and test 109 updated. 第9条の2 still needs a lawyer before launch. Owner decisions taken 2026-10-23:
keep `TRUSTED_SITES_MODE=shadow` (step 2), raise 旧表示指定成分 to `low_caution` (step 4c), adopt the
reworded 第9条の2 (step 6).

The audit is `docs/legal/pre-publish-legal-audit-report.md` (2026-10-23, against `52e1e08`).
`docs/legal/` is gitignored, so this plan restates each finding briefly. Every finding was checked
against the code at `52e1e08`. The audit's line numbers and some function names are out of date
(for example `canShareWebProduct` is now `mayShareWebProduct`), so the locations below are the
current ones. Some quotations of the privacy policy are not in the published text
(`src/app/privacy/page.tsx`); where that changes the finding, the table says so.

I'm not a lawyer. Steps 1, 3, 5 and 8 fix a mismatch between what the site says and what the code
does, or remove wording the earlier audit already ruled out. Steps 4c and 6 changed behaviour or a
contract clause, so the owner decided them.

## Summary

| # | Audit finding | Verified? | Plan |
|---|---|---|---|
| C1 | Typeahead sends unsent chat text (symptoms, phone numbers) to Open Beauty Facts | **Yes.** The quoted policy sentences aren't in the published text, but 第5条 says Open Beauty Facts gets only 「検索欄・チャットに入力された商品名」, and whole sentences go out | Step 1 |
| C2 | Privacy policy promises trusted-sites-only sharing, production runs `shadow` | **No.** Production does run `shadow`, but the published 第2条第6項 makes no trusted-sites promise; it says found products are kept up to 30 days and shown to others, which is what `shadow` does. The barcode cache write is already filtered (`isShareable`, `search-barcode-service.ts:298`) | Step 2: no change (owner: keep `shadow`) |
| C3 | 「出典: 楽天市場の商品説明」 is an affiliate link with no visible PR | **Yes** | Step 3 |
| C4a | 酸化ジルコニウム is banned but rated safe | **No.** It isn't in 別表第1. ジルコニウム is in 別表第2の2 (not allowed in aerosols only) | Not changing (see below) |
| C4b | Products with banned / not-allowed-here ingredients pass the alternatives gate and get the green badge | **Yes** | Step 4 |
| C4c | 旧表示指定成分 (TEA, BHT, EDTA, セタノール…) rated `safe` | **Yes** | Step 4c (owner: raise to `low_caution`) |
| H5 | Terms 第9条第4項 still says 「一切責任を負いません」 | **No.** 第9条 has one paragraph and no such wording (test 109 forbids it) | Not changing |
| H5 | 第9条の2第1項 says both 「故意・重過失を除き」 and 「軽過失に限り」 | **Yes**, redundant | Step 6 (owner: adopt the rewording) |
| H6 | @cosme SHOPPING missing from the legal texts | **Partly.** Its links are plain (no `COSME_AFFILIATE_LINK_TEMPLATE` is set), so the consent dialog and the 外部送信 table don't need it. The terms' list of external services should name it | Step 7 |
| H7 | Privacy 第2条第6項 says caches last 30 min–1 day; several last 7 days | **Yes** | Step 7 |
| H8 | Three rule texts in `dynamic-ingredient-service.ts` overstate | **Yes** | Step 5 |
| M9 | Privacy policy shows no 最終改定日 | **Yes** | Step 7 |
| M10 | Comments say prices aren't cached; product-page offers are cached 15 min | **Yes** | Step 8 |

## Step 1: typeahead must not send personal text abroad (C1)

**Now.** `ChatContainer.tsx:303-346` calls `GET /api/products/search?q=<input>` 300 ms after each
keystroke, before the user presses send. The route (`src/app/api/products/search/route.ts`) runs no
chat gate and calls `searchCosmeticsLive(q, …)`, which sends the raw text to
`world.openbeautyfacts.org` (France) at `live-cosmetics-service.ts:458`, and with `clean ||
'スキンケア'` at `:405`. Typing 「妊娠中ですがキュレルの化粧水で顔が赤く腫れました」 or a phone number
reaches Open Beauty Facts. The privacy policy (第2条第2項, 第5条) says this doesn't happen. KV keys
are SHA-256 hashes, so the KV part of the audit's claim is already handled.

**Change.**
1. In the route, before any external lookup, decide whether the text may leave the server:
   `classifyWithHeuristics(q).scope === 'in_scope'` **and** `toProductSearchQuery(q) !== null`
   (that function already rejects contact details, personal context such as 妊娠中, sentences and
   instruction-like text). If not, call `searchCosmeticsLive` with `openBeautyFacts: false`, so the
   user still gets matches from the saved products and brands, and nothing goes out.
   Use the keyword gate only, not Clef: this runs on every keystroke and must stay free and fast.
2. In `searchCosmeticsLive`, pass the sanitised query to Open Beauty Facts at both call sites
   (`:405`, `:458`), and skip the call when it is null. This also covers any future caller.
3. Tests: with `fetch` stubbed, the two sentences above and 「山田花子 090-1234-5678 化粧水」 make
   no request to `openbeautyfacts.org`; 「キュレル 化粧水」 still does.

No legal text change: the policy already describes the fixed behaviour.

## Step 2: trusted-sites sharing (C2): no change

Production runs `TRUSTED_SITES_MODE = "shadow"` (`wrangler.toml:143`): web results from any site go
into the shared 30-day cache, and the logs record which hosts would be trusted. The audit says the
privacy policy promises trusted sites only, but that sentence isn't in the published policy.
第2条第6項 says products found by search, barcode lookup and web research are kept up to 30 days
and shown to other users, which matches `shadow`.

**Owner decision (2026-10-23): keep `shadow`.** No code or policy change. If the mode is later set
to `enforce` (`docs/plans/trusted-sites.md`), the policy can then say only trusted sites are shared.
Step 7 must not add a trusted-sites promise.

## Step 3: visible PR on the Rakuten source link (C3)

**Now.** For products read from a Rakuten listing, `ProductSourceLink.tsx` shows
「出典: 楽天市場の商品説明」 linking to the Rakuten **affiliate** URL (`shop-ingredients.ts:247`),
with `rel="sponsored"` but no visible PR. Under the ステマ告示 an affiliate link needs a visible
label.

**Change.** Keep the affiliate link (the code comment cites Rakuten Web Service terms 第3条・第10条,
which require links to Rakuten pages to be affiliate links, so the audit's method A of linking the
plain `itemUrl` may break those terms) and use the audit's method B:
- `ProductSourceLink`: when the link is sponsored (`ingredientSource === 'shop_listing'`), show a
  `PR` badge next to it, using the same badge as the other PR labels.
- `IngredientAnalysisCard.tsx:659`: the button 「同じ種類で原因候補の成分を含まない商品を探す」
  opens shop results with affiliate links. Add 「（PR）」 to the label or a one-line note under it.
- Test: the source link and the button render a visible PR when sponsored.

## Step 4: Japanese cosmetic standard and 旧表示指定成分 in ratings (C4)

**4b (go ahead).** The card already prints a notice for ingredients banned in Japan
(`standardLabelNotes`, `jp-standards.ts:141`), but:
- `alternativeGate` (`ingredient-analyzer.ts:251`) doesn't check the standard, so such a product
  can be recommended as an alternative (with affiliate links). **Change:** reject a candidate when
  any label ingredient matches a 別表第1 entry, or a 別表第2〜4 entry that is `notAllowedHere` for
  that product's use type (`productUseType`). Quasi-drugs stay exempt, as in `standardLabelNotes`.
- The headline can still read 「刺激になりやすい成分なし（目安）」 in green
  (`IngredientAnalysisCard.tsx:282`). **Change:** when `standardLabelNotes` returns a note, use a
  neutral headline such as 「日本の化粧品基準の注意あり」 instead of the green one.

I won't force these ingredients to `high_irritant` as the audit suggests: that rating means "often
irritates", which isn't what the standard says, and it would push them into the culprit list.

**4c (owner: raise to `low_caution`).** The rules rate several 旧表示指定成分 as `safe` (green): TEA
(`dynamic-ingredient-service.ts:394-408`), BHT and EDTA (Rule 20), セタノール and other fatty
alcohols (Rule 20c, `:165`). The same card can show both the 「表示指定成分（旧）」 badge and a
green rating.
- **Decided:** when an ingredient has `jpDesignated` and the rating is `safe`, show it as
  `low_caution` (肌質により注意). **Narrowed during implementation:** wheat-derived names are not
  raised. The only ones rated `safe` are refined substances such as 「グリセリン（小麦由来）」, which
  test 74 deliberately keeps green; 加水分解コムギ is already `low_caution` in the ingredient DB, and the
  card shows the wheat-allergy note either way. **Owner decision (2026-10-23):** raised ingredients
  don't count toward the 3-ingredient 「やや注意」 threshold, so product verdicts don't change (a test
  run showed typical emulsions with セタノール, EDTA and BHT would otherwise flip to 「やや注意」). Rewrite the TEA text (see step 5).
  Effect: these common ingredients turn yellow on many cards. The alternatives gate is unaffected
  (it only blocks `high_irritant` and `moderate_irritant`). Check how `low_caution` weighs in the
  culprit comparison before shipping, so ingredients shared by the "fine" products don't start
  showing up as candidates.
- Rejected: keep `safe` and only change the wording.
- Add a test: TEA, BHT, EDTA and セタノール analyse as `low_caution`, water and glycerin stay
  `safe`, and the product verdict is unchanged.

## Step 5: three rule texts (H8, plus TEA from C4c)

| Where | Now | Change to |
|---|---|---|
| `dynamic-ingredient-service.ts:747` (Rule 21, plant extracts / ferments) | …美容成分…肌のキメや透明感をサポートします。 | 保湿や肌を整える目的で配合される、植物・発酵由来の成分です。 |
| `:552` (Rule 17, plant oils and waxes) | …化学的刺激性はほとんどなく、バリア機能が低下した肌の水分保護に適しています。 | 肌の表面をおおって水分の蒸発を防ぎます。植物由来の油脂・ロウは、まれに肌に合わない場合があります。 |
| `:408` (Rule 10, pH adjusters incl. TEA) | …直接的なアルカリ刺激の心配は通常ありません。 | 製品のpHを調整するために配合され、最終製品中では中和されています。まれに肌に合わない場合があります。 |

Add 「透明感」 (outside the 56 efficacy items for a cosmetic), 「心配は(通常)?ありません」 and
「刺激性はほとんどない」 to `PROHIBITED` in `src/lib/wording.ts`, so AI text is checked too, and add
a test that runs every rule's `reasonJa` / `sensitiveSkinAdviceJa` through `hasProhibitedClaim`.

## Step 6: 第9条の2 wording (H5): owner adopted the rewording

The audit's draft keeps the light-negligence limit that 消費者契約法第8条第3項 requires and reads
better. New 第1項:

> 1. 本サービスに関して当方がユーザーに対して損害賠償責任を負う場合、当方の軽過失によるときは、ユーザーに現実に生じた通常かつ直接の損害に限り賠償するものとします（当方の故意または重大な過失による場合は、この限りではありません）。
> 2. （unchanged）前項は、人の生命または身体に生じた損害については適用しません。

Still worth a lawyer's read before launch (open since `docs/plans/compliance-audit-fixes.md` step 6).
Update test 109's expected text.

## Step 7: legal texts and one version bump (H6, H7, M9, plus step 6)

- **Terms 第2条第4項** (外部サービス): add 「@cosme SHOPPING」. **第10条第2項**: add it to the
  list of linked malls. The consent dialog and privacy 外部送信 table stay as they are while
  `COSME_AFFILIATE_LINK_TEMPLATE` is unset (the `wrangler.toml:148` comment already says to add
  them when it is set).
- **Privacy 第2条第6項**: 「短期間（30分〜1日。ブランド名の確認結果は最長90日）」 →
  「短期間（15分〜7日。ブランド名の確認結果は最長90日）」. Actual values: price pages 15 min,
  question answers 30 min, search results 1 h, verdicts 1 day, cause / ingredient replies, web
  facts and barcode results 7 days, brand checks 90 days. Product data and explanations (30 days)
  are covered by the sentence before it.
- **Privacy page**: pass `revisedOn={formatLegalDate(LEGAL_VERSION)}` to `LegalPage`, like the terms.
- `LEGAL_VERSION` → `'2026-10-23'` (everyone agrees again), with the changed articles in the
  comment. Mirror the changes in `docs/legal/terms-of-service.md` and `privacy-policy.md`.
- Tests: extend 109 (terms) and the privacy test for the new text and the 最終改定日.

## Step 8: price cache comments (M10)

Make the comments match the 15-minute cache of product-page offers
(`PAGE_OFFERS_TTL_SECONDS`, `price-service.ts:15`): `price-service.ts:23`, `types/index.ts:199`,
`app/api/chat/route.ts:420`. Comment-only.

## Order and release

1. Steps 1, 3, 4b, 4c, 5 and 8.
2. Step 6, then step 7 last, so the legal texts describe the final behaviour and `LEGAL_VERSION` is bumped once.
4. Run the tests, `scripts/check-responsive.mjs` for the PR badge and headline, the code review,
   then deploy together. A live check: type a symptom sentence in the chat box and confirm with
   `wrangler tail` that no Open Beauty Facts request is made.

## Not changing

- **C4a, 酸化ジルコニウム:** not in 別表第1. Japan restricts ジルコニウム (別表第2の2) only in
  aerosols. Its entry has no names, so it never matches; adding names is optional and low value.
- **C2:** the policy already matches `shadow`, and the owner keeps `shadow`. The barcode cache
  write already goes through `isShareable` → `mayShareWebProduct`.
- **H5, 第9条第4項:** the quoted sentence isn't in the terms.
- **C4b, forcing `high_irritant`:** see step 4.
