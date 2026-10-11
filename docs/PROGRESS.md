# Progress

The single place to see what's done and what's next. The details are in the linked docs. Update this
file in the same commit as the work it describes.

Last updated: 2026-10-12.

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
| 2026-10-12 | *this commit* | Maintenance: CI, README, `compatibility_date`, `fuse.js` removed, Next pinned to 16.3.8 (Worker fix), analyzer matching fixes and tests |

## In progress

**Gemini redesign, phase 2: `web-research.ts`** ([plan](plans/gemini-role-redesign.md#phases)).
Search the web with Cloudflare Web Search (Exa, then Linkup if Exa fails), read the result pages
with Gemini URL context, and keep a source URL for each item. It replaces the Google-grounded product
discovery and the AI guess when a barcode isn't found. After this, user text no longer goes to
Google search.

## Next

In order:

1. **Redesign phases 3–6** ([plan](plans/gemini-role-redesign.md#phases)):
   - phase 3: alternatives;
   - phase 4: prices;
   - phase 5: `summarizeResults()` replaces chat replies;
   - phase 6: remove Google grounding.
2. **Redesign phases 7–8:** source links, a price card, tests.
3. **Clef search filter** ([plan](plans/clef-chat-gate-and-search-filter.md), phase 2): one
   `clef-flash` call per search that drops irrelevant results.
4. **Don't trust product data from the browser**
   ([03](review/03-other-upgrades.md#security-and-data-trust)): look products up on the server.
   Best done together with redesign phase 2 or 5.
5. **Cost tracking** ([02 #7](review/02-cost-and-model.md#7-measure-first)): per-route counters,
   and Gemini `usageMetadata` logging.

## Later (product)

From [03, Product](review/03-other-upgrades.md#product):
- ingredient label input (paste or photo);
- where each product's data came from, shown on its card;
- keep the bad and safe lists across reloads.

## Watch

- **Next 16.4:** pinned to 16.3.8 until
  [opennextjs-cloudflare#1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355) is
  fixed. Upgrade, then check `pnpm build:cloudflare` and `wrangler dev` serve pages.
- **Exa terms:** never send user chat text as a search query, and never cache Exa or Linkup
  results ([plan](plans/gemini-role-redesign.md#storage-and-caching-by-provider-terms)).
