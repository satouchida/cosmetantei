# Other upgrades

Review date: 2026-10-08, against commit `623dfc9`. Line numbers refer to that commit.

## Security and data trust

- [ ] **Keep the Gemini key out of the Cloudflare build.** `npm run build:cloudflare` copies values
  from `.env.local` into `.open-next/cloudflare/next-env.mjs`, so `GEMINI_API_KEY` ends up inside
  the deployed Worker script. It stays server-side (not sent to browsers), but anyone with access
  to the Worker code can read it, and it may take precedence over the `wrangler secret`. Put local
  secrets in `.dev.vars` instead of `.env.local`, rebuild, and rotate the key if a build containing
  it was deployed.
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

- [ ] **Lint.** The `lint` script runs `next lint` but there is no ESLint config, and `next lint`
  is deprecated in newer Next versions. Add `eslint.config.mjs` with `eslint-config-next` and run
  `eslint .` directly.
- [ ] **Wrangler.** Update `compatibility_date` in `wrangler.toml:3` (currently `2024-09-23`) and
  re-test.
- [ ] **CI.** Add a workflow running `npm ci`, `tsc --noEmit`, lint and tests on push.
- [ ] **Unused dependency.** `fuse.js` is in `dependencies` but nothing in `src/` imports it.
  Remove it.
- [ ] **README.** Setup (`.env.local`, `wrangler secret put GEMINI_API_KEY`), dev, test and deploy
  commands.

## Product

- [ ] **Let users paste or photograph the ingredient label.** The fallback reply already asks for
  this (`gemini.ts:259`), but there is no input for it. A label read from the package is the most
  reliable source and avoids grounded search entirely.
- [ ] **Show where ingredient data came from** (Open Beauty Facts, user label, AI estimate) on each
  product card, not only in the disclaimer text.
- [ ] **Persist the routine** (bad/safe products) per user in KV or `localStorage`, so the
  differential analysis survives a reload.
