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
- [ ] **Don't trust product objects from the browser.**
  `src/app/api/chat/route.ts:65` (`selectedProduct`, `routine`) and `src/app/api/analyze/route.ts`
  accept full `Product` objects, including ingredient lists, and put their text straight into
  Gemini prompts. Accept product IDs or barcodes and look products up on the server.
  *Partly done:* shape and size limits are enforced by `src/lib/server/validation.ts`; the routes
  still trust client-supplied ingredient lists.
- [ ] **Restrict remote images.** `next.config.mjs:8` sets `hostname: '**'`, which lets anyone run
  any image through your image optimizer. Limit it to `images.openbeautyfacts.org` and any other
  hosts you actually use.

## Tests

- [x] **Mock the network.** Tests now stub `fetch` and run offline (about 0.25 seconds in total).
- [ ] **Replace test 17.** It only checks that a UI file doesn't contain a string.
- [x] **Rewrite tests that assert synthesis.** Done together with fix 01 #1.
- [ ] Add tests for the analyzer edge cases: `findMatchingKnownIngredient` substring matches
  (`ingredient-analyzer.ts:59-90`) and differential analysis with zero safe products.

## Tooling and config

- [x] **Lint.** `next lint` was removed in Next 16. `pnpm lint` now runs `eslint .` with
  `eslint.config.mjs` (`eslint-config-next` core-web-vitals + typescript). TypeScript 7 has no API, so
  `typescript` is aliased to `@typescript/typescript6` for tooling, with TS 7 as `@typescript/native`
  (`tsc`). 0 errors and 0 warnings.
- [ ] **Wrangler.** Update `compatibility_date` in `wrangler.toml:3` (currently `2024-09-23`) and
  re-test.
- [ ] **CI.** Add a workflow running `pnpm install --frozen-lockfile`, `tsc --noEmit`, lint and tests on push.
- [ ] **Unused dependency.** `fuse.js` is in `dependencies` but nothing in `src/` imports it.
  Remove it.
- [ ] **README.** Setup (gateway token `CF_AIG_TOKEN` in `.dev.vars` for `pnpm dev` and
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
