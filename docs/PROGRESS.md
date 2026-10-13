# Progress

The single place to see what's done and what's next. The details are in the linked docs. Update this
file in the same commit as the work it describes.

Last updated: 2026-10-13.

## Done

| Date | Commit | What |
| --- | --- | --- |
| 2026-10-08 | `c6b7f66` | Review notes: [fixes](review/01-fixes.md), [cost and model](review/02-cost-and-model.md), [other upgrades](review/03-other-upgrades.md) |
| 2026-10-08 | `767e52d` | All 8 fixes in `01-fixes.md`: no fabricated products, "unknown" risk level, KV caching, rate limits, structured Gemini output |
| 2026-10-09 | `f0761d0` | Brand check without extra Gemini calls (precheck, cache, Clef fallback) |
| 2026-10-09 | `c72b846` | KV cache enabled; Gemini key kept out of every build |
| 2026-10-09 | `45f2fe4` | Gemini and Clef go through Cloudflare AI Gateway (BYOK) |
| 2026-10-09 | `048ce72` | Gemini thinking level `low` (about 55% fewer output tokens) |
| 2026-10-11 | `430fe1a` | Clef chat gate in enforce mode ([redesign](plans/gemini-role-redesign.md), phase 1); plans committed |
| 2026-10-11 | `75c66d2` | pnpm, Next 16, Tailwind 4, TypeScript 7, ESLint |
| 2026-10-11 | `9fb3b1e` | Quick-reply buttons handled in the browser; `pnpm dev` fixed ([walkthrough](walkthroughs/2026-10-11-ui-fixes.md)) |
| 2026-10-12 | `7585824` | Maintenance: CI, README, `compatibility_date`, `fuse.js` removed, Next pinned to 16.3.8 (Worker fix), analyzer matching fixes and tests |
| 2026-10-12 | `b3fe5b3` | Redesign phase 2: web research (Cloudflare Web Search + Gemini URL context) replaces Google-grounded product discovery and the barcode AI guess ([status](plans/gemini-role-redesign.md#phase-2-status-2026-10-12-done)) |
| 2026-10-12 | `2a52e38` | Redesign phases 5 and 6: template chat replies, short tool-free Gemini replies for the cause and ingredient questions, Google grounding removed ([status](plans/gemini-role-redesign.md#phases-5-and-6-status-2026-10-12-done)) |
| 2026-10-12 | `79e2e06` | Ingredient database audit: all 35 entries checked against regulations and safety assessments, with sources and review dates; CI warns after 12 months ([plan](plans/ingredient-db-audit.md), [walkthrough](walkthroughs/2026-10-12-ingredient-db-audit.md)) |
| 2026-10-12 | `a9cc10b` | Japanese-market data, step 4: quasi-drug (医薬部外品) labels. Active ingredients are analysed, 「他 n成分」 and the unordered 「その他の成分」 are explained, splitting no longer breaks names like 1,3-ブチレングリコール, and the official quasi-drug names are matched ([plan](plans/japan-ingredient-data.md), [walkthrough](walkthroughs/2026-10-12-quasi-drug-labels.md)) |
| 2026-10-12 | `9e50058` | Step 4's known limits: 「・」-only labels rejoin names by JCIA's 簡略名 guideline, old saved Open Beauty Facts products are fetched again, abbreviated and full names match (POE/Na/2K), and the name list edition is confirmed ([walkthrough](walkthroughs/2026-10-12-quasi-drug-labels.md#follow-up-the-same-day-the-known-limits)) |
| 2026-10-12 | `8cfe0ad` | Quasi-drug analyses link to JCIA's name list and labelling policy as their source (cited by link, not copied) ([walkthrough](walkthroughs/2026-10-12-quasi-drug-labels.md#citing-jcia-by-link)) |
| 2026-10-12 | `b8ccd57` | Ingredient label input: paste a label or photograph it (Gemini transcribes, the user checks, our parser analyses with no AI call); labels aren't stored or shared ([plan](plans/label-input.md), [walkthrough](walkthroughs/2026-10-12-label-input.md)) |
| 2026-10-13 | `f983d3f` | Redesign phases 3 and 4: alternatives without the culprits and confirmed shop prices, through web research; queries built only from DB names and product names, every alternative re-checked in code, prices never cached ([walkthrough](walkthroughs/2026-10-13-alternatives-and-prices.md)) |
| 2026-10-13 | `8ab108f` | Prices only from 楽天市場 (with 楽天24), Yahoo!ショッピング and @cosme SHOPPING: their APIs when the keys are set, otherwise their product pages; affiliate links once the IDs are set, with 「PR」 and the API credits; no Amazon prices ([plan](plans/shop-prices.md), [walkthrough](walkthroughs/2026-10-13-shop-prices.md)) |
| 2026-10-13 | `ed7d7c9` | Redesign phases 7 and 8: 「出典」 links on product, alternative and analysis cards (web page, Open Beauty Facts, the user's label), a 「Web検索」 badge, the alternatives heading and note; tests that refused messages make no paid call ([walkthrough](walkthroughs/2026-10-13-source-links.md)) |
| 2026-10-13 | `12c2fbf` | Clef search filter (phase 2), built and **off by default** (`SEARCH_FILTER_MODE`): on our real results it hid nothing real and caught every planted non-cosmetic, but today's results have nothing to remove. Clef model IDs fixed (`clef-flash` needs its own ID) ([plan and eval](plans/clef-chat-gate-and-search-filter.md#phase-2-evaluation-2026-10-13)) |
| 2026-10-13 | `e8ae5e8` | Products from the browser: the server's copy wins for known IDs; sent products stay out of shared caches and Gemini prompts (test 71); a cold-start hydration race, a cross-user spelling leak in rule-generated ingredient entries, and the missing `/api/analyze` rate limit fixed ([walkthrough](walkthroughs/2026-10-13-browser-products.md)) |
| 2026-10-14 | `1abb585` | Ingredient explanations audit: rules fixed for look-alike names (サリチル酸ベンジル read as BHA, magnesium sulfate as a harsh sulfate, plain betaine as a cleanser, plant waters as water) and new rules for fragrance allergens, plant waters, emulsifiers and AHAs; the AI explanation takes the name as data, keeps the database's rating, shares no spelling, and never feeds analysis (test 72) ([walkthrough](walkthroughs/2026-10-14-ingredient-explanations.md)) |
| 2026-10-14 | `412fac6` | Japan step 2, 化粧品基準: all 130 別表 entries as data (from the MHLW 告示); ingredient cards show the limit per product type with a link to the 告示; product notes for banned ingredients and ones not allowed for the product's type (cosmetics only); test 73 ([walkthrough](walkthroughs/2026-10-14-cosmetic-standards.md)) |
| 2026-10-14 | *this commit* | Japan step 3, incidents: sourced entries for ロドデノール (recalled 2013) and 加水分解コムギ (the 茶のしずく石鹸 allergy cases); wheat-derived ingredients flagged on the card and the product, and 「（小麦由来）」 no longer stops a name from matching; test 74 ([walkthrough](walkthroughs/2026-10-14-japan-incidents.md)) |

## In progress

Nothing.

## Next

In order:

1. **Japanese-market data, steps 5 and 6** ([plan](plans/japan-ingredient-data.md#steps)):
   pair rules across products, and 旧表示指定成分. Steps 2 and 3 are done. Step 1 (the JCIA name
   lists) waits for JCIA's permission.
2. **Cost tracking** ([02 #7](review/02-cost-and-model.md#7-measure-first)): a hard cap on paid
   web lookups (separate rate-limit binding); per-route counters,
   and Gemini `usageMetadata` logging.
3. **Type-ahead for Japanese products:** `/api/products/search` returned 1 product for 30 queries
   (it uses only cached products and Open Beauty Facts, which has almost no Japanese data). Use the
   verified products already researched (KV), and consider a longer Open Beauty Facts timeout
   (`nivea` took 2.3 s against 2.5 s).

## Later (product)

From [03, Product](review/03-other-upgrades.md#product):
- where each product's data came from, shown on its card;
- keep the bad and safe lists across reloads.

## Watch

- **Ingredient database review:** due 2027-10-12; test 55 warns in CI. At the same review, check
  whether JCIA has published a newer quasi-drug name list (current: 2008-03-25 edition).
- **JCIA:** the analysis card links to JCIA's quasi-drug name list and labelling policy. JCIA's
  site policy asks to be told about links; JCIA was told on 2026-10-13. If a linked URL moves,
  update `QUASI_DRUG_LABEL_REFERENCES`. Importing its name lists still needs JCIA's permission.

- **Next 16.4:** pinned to 16.3.8 until
  [opennextjs-cloudflare#1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355) is
  fixed. Upgrade, then check `pnpm build:cloudflare` and `wrangler dev` serve pages.
- **Shop keys and affiliate IDs:** waiting on the owner. Rakuten prices need the Rakuten API keys
  (the web search almost never finds Rakuten product pages). When they arrive, follow the
  [to-do list](walkthroughs/2026-10-13-shop-prices.md#to-do-when-the-ids-and-keys-arrive).
- **Exa terms:** never send user chat text as a search query, and never cache Exa or Linkup
  results ([plan](plans/gemini-role-redesign.md#storage-and-caching-by-provider-terms)).
