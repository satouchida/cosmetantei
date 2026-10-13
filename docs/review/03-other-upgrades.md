# Other upgrades

Review date: 2026-10-08, against commit `623dfc9`. Line numbers refer to that commit.

## Security and data trust

- [x] **Keep the Gemini key out of the Cloudflare build.** `pnpm build:cloudflare` copies the
  values of every `.env*` file, for all three modes (production, development, test), into
  `.open-next/cloudflare/next-env.mjs`, which ships inside the Worker script. Resolved by moving
  Gemini behind Cloudflare AI Gateway: the Gemini key is stored in the gateways' Provider Keys
  (`cosmetantei-dev`, `cosmetantei-prod`), and the app only holds the gateway token `CF_AIG_TOKEN`
  (`.dev.vars` locally, `wrangler secret put` in production). Rotate the old Gemini key if a build
  made while it was in `.env.local` was deployed, and delete the unused `GEMINI_API_KEY` Worker secret.
- [x] **Don't trust product objects from the browser.**
  `src/app/api/chat/route.ts:65` (`selectedProduct`, `routine`) and `src/app/api/analyze/route.ts`
  accept full `Product` objects, including ingredient lists, and put their text straight into
  Gemini prompts. Accept product IDs or barcodes and look products up on the server.
  *Resolved 2026-10-13* ([walkthrough](../walkthroughs/2026-10-13-browser-products.md)):
  - **The server's copy wins.** When the server holds a verified product with the same ID, the
    routes use it: its name, ingredients and source (`src/lib/server/client-products.ts`). A product
    edited in the browser is analysed, compared and priced as the server knows it.
  - **Other products are taken as sent, for the sender only.** Labels the user typed are never
    stored, so there is nothing to look up. These products go into the sender's own response, and
    nowhere else:
    - not into shared caches (KV or the in-memory product cache);
    - not into other users' search results or alternatives;
    - not into Gemini prompts. Since phases 5 and 6 the cause reply gets only ingredient-DB facts,
      and the other replies are templates.
  - **Test 71** locks these in.
  - **Shape and size limits** stay in `src/lib/server/validation.ts`.
- [x] **Restrict remote images.** *Resolved:* the `images` block was removed from
  `next.config.mjs` in `75c66d2`, and nothing uses `next/image`, so there is no image optimizer to
  abuse. Original note: `next.config.mjs:8` sets `hostname: '**'`, which lets anyone run
  any image through your image optimizer. Limit it to `images.openbeautyfacts.org` and any other
  hosts you actually use.

## Tests

- [x] **Mock the network.** Tests now stub `fetch` and run offline (about 0.25 seconds in total).
- [x] **Replace test 17.** It only checked that a UI file didn't contain a string. It now checks
  that only real label data (Open Beauty Facts, user label) counts as verified ingredients.
- [x] **Rewrite tests that assert synthesis.** Done together with fix 01 #1.
- [x] Add tests for the analyzer edge cases: `findMatchingKnownIngredient` substring matches
  (`ingredient-analyzer.ts:59-90`) and differential analysis with zero safe products.
  *Done (tests 48, 49).* They found real bugs, now fixed:
  - fatty alcohols (セテアリルアルコール, cetyl alcohol, ベヘニルアルコール), ベンジルアルコール and
    トリエタノールアミン were classified as ethanol, so most creams were flagged as containing alcohol;
  - ジプロピレングリコール (DPG) matched PG, and エチルヘキシルグリセリン / ポリグリセリン matched glycerin;
  - with no safe products, the summary claimed a comparison had been made.
  - full-width label text (ＢＧ, ＤＰＧ, common on brand sites) never matched; names are now
    NFKC-normalized.
  Review follow-ups: qualified labels (プロピレングリコール(PG), 植物性グリセリン) still match; more
  ethanol spellings (Denatured Alcohol, SDアルコール, 発酵アルコール) match; ethanolamides don't;
  benzyl alcohol has its own entry (fragrance allergen, low caution).

## Tooling and config

- [x] **Lint.** `next lint` was removed in Next 16. `pnpm lint` now runs `eslint .` with
  `eslint.config.mjs` (`eslint-config-next` core-web-vitals + typescript). TypeScript 7 has no API, so
  `typescript` is aliased to `@typescript/typescript6` for tooling, with TS 7 as `@typescript/native`
  (`tsc`). 0 errors and 0 warnings. `pnpm typecheck` runs `tsc --noEmit`.
- [x] **Wrangler.** `compatibility_date` is now `2026-10-01`. Re-testing the Worker found that
  Next 16.4 breaks it (every page 500, unrelated to the date;
  [opennextjs-cloudflare#1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355)),
  so `next` is pinned to 16.3.8 and `@opennextjs/cloudflare` is 1.20.10. Home, search and chat
  return 200 under `wrangler dev`.
- [x] **CI.** `.github/workflows/ci.yml`. Add a workflow running `pnpm install --frozen-lockfile`, `tsc --noEmit`, lint and tests on push.
- [x] **Unused dependency.** `fuse.js` removed.
- [x] **README.** Setup (gateway token `CF_AIG_TOKEN` in `.dev.vars` for `pnpm dev` and
  `wrangler dev`, `wrangler secret put CF_AIG_TOKEN` in production; never in any `.env*` file),
  dev, test and deploy commands.

## Product

- [ ] **Let users paste or photograph the ingredient label.** The fallback reply already asks for
  this (`gemini.ts:259`), but there is no input for it. A label read from the package is the most
  reliable source and avoids grounded search entirely.
- [ ] **Show where ingredient data came from** (Open Beauty Facts, user label, AI estimate) on each
  product card, not only in the disclaimer text.
- [ ] **Persist the routine** (bad/safe products) per user in KV or `localStorage`, so the
  differential analysis survives a reload.
