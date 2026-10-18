# Progress

The single place to see what's done and what's next. The details are in the linked docs. Update this
file in the same commit as the work it describes.

Last updated: 2026-10-18.

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
| 2026-10-14 | `e32accb` | Japan step 3, incidents: sourced entries for ロドデノール (recalled 2013) and 加水分解コムギ (the 茶のしずく石鹸 allergy cases); wheat-derived ingredients flagged on the card and the product, and 「（小麦由来）」 no longer stops a name from matching; test 74 ([walkthrough](walkthroughs/2026-10-14-japan-incidents.md)) |
| 2026-10-14 | `86b074a` | Japan step 5, pair rules: the comparison warns when the problem products combine a retinoid with salicylic acid, exfoliants in several products (with the AHA sun note), or fragrance in several products, each with its source; test 75 ([walkthrough](walkthroughs/2026-10-14-pair-rules.md)) |
| 2026-10-14 | `6b14a2c` | 「今使っているコスメ」: a third list, filled from the product cards, saved only in this browser with the date each item was added; 「組み合わせをチェック」 runs the pair rules on it without AI; items added 3+ months ago get a banner asking the user to confirm or remove them; test 76 ([walkthrough](walkthroughs/2026-10-14-current-use.md)) |
| 2026-10-14 | `e7dfca2` | Japan step 6, 表示指定成分: the 1980 告示 was repealed in 2001, so the app uses the current quasi-drug list (告示第332号, 140 items, with the 2007 label aliases); ingredient cards say an ingredient is designated, with the notice; ratings unchanged; test 77 ([walkthrough](walkthroughs/2026-10-14-designated-ingredients.md)) |
| 2026-10-14 | `4db6592` | Cost tracking: every Gemini, Workers AI and web-search call writes a usage record (route, task, model, outcome, tokens, time; no text) to the log and Workers Analytics Engine; paid web searches capped at 30 per minute per Cloudflare location; test 78 ([walkthrough](walkthroughs/2026-10-14-cost-tracking.md)) |
| 2026-10-14 | `26312f7` | Strict spend cap: one Durable Object counts every web search, Gemini and Workers AI call across all users, per minute and per UTC day (`SPEND_CAP_*` in `[vars]`); over the cap the call is skipped and recorded as `capped`; it fails closed; replaces the per-location `WEB_SEARCH_LIMITER`; the Worker entry is now `worker.ts`; test 79 ([walkthrough](walkthroughs/2026-10-14-cost-tracking.md#strict-spend-cap)) |
| 2026-10-15 | `ad73ef3` | Spend budget: the cap now counts dollars, $30 per UTC day and $100 per UTC month for Gemini, Workers AI and web search together (`SPEND_BUDGET_USD`); each call reserves a high estimate from the price list (`prices.ts`) and Gemini calls are settled to the real cost from their token counts; per-minute counts stay per kind (`SPEND_PER_MINUTE_*`); test 79 ([walkthrough](walkthroughs/2026-10-14-cost-tracking.md#budget)) |
| 2026-10-15 | `265d992` | Type-ahead for Japanese products: the search route now loads the products saved in KV; matching handles hiragana/katakana, half-width kana, accents and several words, with a ranked order (`src/lib/search/product-match.ts`, also used by the chat search); Open Beauty Facts only when short of results, with a 4 s timeout; in chat, web research results now come first and a hiragana question about a saved product skips the paid research; the tray no longer keeps old candidates; test 80 ([walkthrough](walkthroughs/2026-10-15-typeahead.md)) |
| 2026-10-15 | `4c467c1` | Brand-first type-ahead: a seed list of 155 brands sold in Japan with kana readings and English spellings (`brands-jp.ts`); the tray shows brand chips (しせ → 資生堂), and a query that starts with a brand shows that brand's saved products narrowed by the rest (「きゅれる 化粧水」); brands of researched products are added automatically; no Open Beauty Facts call while a brand is being typed; test 81 ([walkthrough](walkthroughs/2026-10-15-brand-typeahead.md)) |
| 2026-10-15 | `9aca25a` | Shop lineups: Rakuten Ichiba Item Search (2026-07-01) and Yahoo!ショッピング itemSearch v3, from their docs; when a query starts with a brand, the browser fetches that brand's products once (`/api/products/lineup`, brand name only) and narrows them as the user types; nothing stored on the server (Rakuten terms Art. 10 (7)(9)), cards show the photo, brand and price (no listing name or shop name; names kept unaltered for labels and matching), credits shown, no shop links until affiliate IDs; picking one looks up ingredients by JAN code or by name (`lookup_product`); shop calls counted per minute across users; test 83 ([walkthrough](walkthroughs/2026-10-15-shop-lineups.md)) |
| 2026-10-17 | `a66f761` | Affiliate links on shop cards: Rakuten Affiliate ID and Yahoo! ValueCommerce MyLink in `[vars]`; a small 「商品ページ」 link (no shop name) with 「PR」 and the PR note; Rakuten only as an affiliate link (terms Art. 3, 10 (4)(5)); test 83; test 72 now names the keys of unexpected KV writes, to diagnose its CI-only failure ([walkthrough](walkthroughs/2026-10-15-shop-lineups.md)) |
| 2026-10-17 | `6594643` | CI fix: test 72 failed only on CI since 2026-10-14. Test 70's slow Clef answer is cached after the response (by design); on slower runners that late write landed in test 72's stubbed KV, because tests swap one global Cloudflare env. Test 70 now waits for the late write in its own env and checks it. Test-only; production requests each have their own env |
| 2026-10-17 | `809c9c8` | UI redesign to the Stitch 「cosmetantei」 design system (Clinical Mint & Botanical Care, Material 3): emerald primary and Noto Sans JP tokens in `globals.css`; shared styles in `src/components/ui/design.ts`; native `<dialog>` modals (`ModalDialog.tsx`) for the label and barcode windows; phone routine drawer rebuilt (opaque, close button, Escape, focus kept inside, background inert); 48px tap targets and a 12px type floor; WCAG AA contrast incl. input borders; app icon, apple-touch icon and web manifest; test-data button and sample barcodes only in development; PR disclosure on the Amazon alternatives card; camera start-up note in the scanner (hidden once video starts); scanner stop no longer stops a scanner reopened during camera start-up. Checked with axe-core in Chrome (no violations), keyboard, 320px reflow |
| 2026-10-17 | `48d1b11` | Products only on global or English pages are found: when Gemini's copyright filter (`RECITATION`) blocks a page read, pages are read one by one without the gateway cache, then the other search provider (Linkup after Exa) is tried on up to 2 new pages; blocked reads are logged and counted as `recitation` in usage; a temporary failure is never cached as "not found"; English product names ("Lip Creator", "Cleanser") count as cosmetics; English (INCI) ingredient lists are translated to Japanese label names with Gemini after the brand check (`ingredient-translate.ts`, at most 4 products per request, original kept in `ingredientsEn`, a known irritant is never translated away, the card notes the translation); tests 84–86. Checked locally with 「SHISEIDO メン モイスチャライジング リップ クリエイター TINT」 (25 ingredients from the Shiseido global page, all translated) |
| 2026-10-17 | `4263129` | AI ratings for ingredients not in the database: the analysis card asks `/api/analyze` (`aiEvaluate`) after it renders; Gemini (its own knowledge, no web search) rates the ingredients the DB and rules leave 「未評価」, 25 per call, max 50 per product, cached per ingredient for 30 days and shared with 「AIでさらに詳しく調べる」 (`ingredient:v3`, adds the kind of evidence `evidenceJa`, no paper titles or URLs); never changes DB or rule ratings; label names shown, not the AI's; every AI rating is marked and the summary, list and detail say it may be wrong; only for products the server holds (typed labels aren't sent); answers matched by index, long names skipped, "not an ingredient" remembered for a day; tests 72 and 87. SHISEIDO MEN lip: 16 of 18 rated in one call (about $0.008), 「判定できません」 → 「やや注意」 |
| 2026-10-17 | `261b560` | AI ratings, after `/code-review` and ultrareview: one ingredient per Gemini call (replaces the batches of `4263129`, so one planted name can't change other ingredients' shared ratings); at most 20 new calls per analysis, 4 at a time, stopping after 2 failures; bad answers remembered for 1 hour, network or cap failures for 1 minute, "not an ingredient" for 3 hours; names over 60 characters or with invisible characters skipped; analyses never use answers from 「AIでさらに詳しく調べる」 (separate keys, because that button sends the user's own spelling); the button ignores failure markers; Gemini rating and translation calls are background work and may use only half of each minute's Gemini cap (`SPEND_BACKGROUND_SHARE`, [plan](plans/ai-call-limits.md) step 2); a product just found on another server instance is found by re-reading the saved list (skipping the 60-second memory copy) and one retry from the card; typed labels send no request and show a note on the card; the AI-rating note now says when the rating came from the database or the rules; tests 72, 87 and 88. SHISEIDO MEN lip: 16 calls, about $0.016 on the first view |
| 2026-10-18 | `3585847` | Paid-call hardening and abuse limits without login. API routes refuse cross-site calls (Sec-Fetch-Site/Origin) and non-JSON POSTs, cap body sizes, and send security headers (CSP frame-ancestors, HSTS, nosniff). Spend cap: per-client daily budgets ($0.50 per IP and per Turnstile session, $2 per IPv4 /24, $1 per cloud network) that drop to 30% once half the day's $30 is spent; blocked/truncated Gemini outcomes; failure markers so failures aren't paid for on every request; price page offers reused for 15 minutes; 5 price lookups a minute per IP. Gemini: safety settings sent on every call, no gateway retries, hardened system instructions with quoted untrusted data, strict output checks (no links, markup or invisible characters). Turnstile: every AI route needs a signed 24-hour session cookie, which the browser gets by passing Turnstile once (`/api/session`); widget secret and session secret stored as Worker secrets. Tests 89, 90 and 91 ([cost tracking](walkthroughs/2026-10-14-cost-tracking.md), [AI call limits](plans/ai-call-limits.md)) |
| 2026-10-18 | *this commit* | Alternatives of the same kind, step 1: the analysis and comparison cards suggest only products of the same type (a stored type, or one read from the name: 「UV」 → sunscreen, 「リップ」 → lip first), and none when the type is unknown; the card subtitle now says what is checked instead of 「厳選・無香料」; shop search measured for step 2 (Rakuten needs an `Origin` header; Rakuten descriptions carry ingredient lists, Yahoo! has JAN codes; the ingredient database is the bottleneck); test 92 ([plan](plans/alternative-recommendations.md)) |

## In progress

Nothing.

## Next

In order:

1. **Alternatives of the same kind** ([plan](plans/alternative-recommendations.md)): the analysis
   card suggested a lip balm for a sunscreen mist because it ignores the product type and only
   looks at cached products. Step 1 (same category, or none) is small and should ship first. Then
   measure how often shop item text carries ingredients (step 2) before finding candidates through
   the Rakuten and Yahoo! APIs (step 3).
2. **AI call limits** ([plan](plans/ai-call-limits.md)): count AI ingredient-rating calls per
   client, not per request (a second rate limit, `AI_EVAL_RATE_LIMITER`). Measure a week of usage
   first. Keeping half of the per-minute cap for chat (step 2) is done.
3. **Shop API keys:** `RAKUTEN_APPLICATION_ID`, `RAKUTEN_ACCESS_KEY` and `YAHOO_CLIENT_ID` are set
   (production secrets and `.dev.vars`, 2026-10-18). Rakuten rejects calls without an `Origin`
   header (403 `REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING`), which `shop-apis.ts` doesn't send yet.
   Then check one brand's lineup on `wrangler dev` against the live APIs.
   Affiliate links follow when the IDs arrive ([walkthrough](walkthroughs/2026-10-15-shop-lineups.md#not-done)).

## Later (product)

From [03, Product](review/03-other-upgrades.md#product):
- where each product's data came from, shown on its card;
- keep the bad and safe lists across reloads.

## Watch

- **Ingredient database review:** due 2027-10-12; test 55 warns in CI. At the same review, check
  whether JCIA has published a newer quasi-drug name list (current: 2008-03-25 edition).
- **Prices in `src/lib/server/prices.ts`** (checked 2026-10-15): Gemini 3.8 Flash doubles on
  2027-01-01, which is already in the table. Update the table when a price or the model changes;
  an unknown model is estimated at a high price. Compare the budget's totals with the Google and
  Cloudflare bills after the first month.
- **Brand list (`src/lib/data/brands-jp.ts`):** written 2026-10-15 (155 brands). Review it with the
  yearly ingredient review: new and renamed brands, readings.
- **表示指定成分 (告示第332号):** the list is as amended by 平成21年告示第29号, copied from
  Kanagawa's undated checklist. Check for later amendments (MHLW cosmetics page, Tokyo notice
  list) at the yearly ingredient review.
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
