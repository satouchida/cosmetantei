# Plan: share web results only from trusted sites

Written 2026-10-19. Status: approved by the owner on 2026-10-19, not started.

## Why

The pre-launch audit ([walkthrough](../walkthroughs/2026-10-19-prelaunch-audit.md)) closed most
ways to poison the shared caches. One remains: a product read from **any** web page enters the
caches every user reads, under its own id:

- the per-query result cache in KV (`webfacts:v2:<query>` and `altfacts:v1:<query>`, 7 days),
- the in-memory product list (`addProductToDynamicCache`), and
- the KV index of verified products (`rememberVerifiedProducts`), which later requests use to
  replace what the browser sends (`src/lib/server/client-products.ts`).

So a page that ranks for a search (an SEO spam page, a marketplace listing, a hijacked blog) can
put a wrong ingredient list in front of everyone who searches for that product. The audit's
plain-text and instruction checks stop prompt injection, but not a page that simply lists the
wrong ingredients.

The alternatives search is the more exposed path: its queries are built by the app from
ingredient names, so they are the same for every user and easy to target.

## What changes

Each web product's `sourceUrl` host is checked against a list of trusted sites.

| Source | Shown to the requester | Shared caches (KV query cache, memory, verified index) | Used as an alternative |
|---|---|---|---|
| Trusted site | yes | yes, as today | yes |
| Other site | yes, marked 「ほかのサイトの情報」 | **no** | **no** (recommended; see decision 2) |
| Open Beauty Facts, the user's own label | unchanged | unchanged | unchanged |

A product that isn't shared still works for the person who found it: when they press analyze or
compare, the server doesn't have it, so the browser's copy is used for that person only. That
path already exists and is covered by test 71.

## Steps

0. **Measure first (shadow mode).** Add `TRUSTED_SITES_MODE` (`off` | `shadow` | `enforce`, the
   same pattern as `CHAT_GATE_MODE`). In shadow mode, log one line per web product:
   `[trusted-sites] {"trusted":true|false,"host":"<host>","task":"research|alternatives"}`.
   Hosts only. Never log the query, product name or ingredients. Run for about a week and list the
   most common untrusted hosts, to see which belong on the list.
1. **The list.** `src/lib/data/trusted-sites.ts`:
   - **Brand sites:** an optional `domains` field on `BrandEntry` in `src/lib/data/brands-jp.ts`,
     e.g. `kao.co.jp` and `curel.kao.com` for キュレル. A host matches its domain or any
     subdomain, and only over https.
   - **Retailers and databases** with their own ingredient pages, for example drugstore chains'
     online shops and the brand-run shops on Rakuten and Yahoo!. The shadow-mode log decides the
     list; nothing is added without checking that the site publishes full ingredient lists.
   - **Never trusted:** marketplace seller listings (Amazon, Rakuten and Yahoo! item pages,
     Mercari), blogs, Q&A sites, and anything on the opt-out list (cosmetic-info.jp is not read
     at all).
2. **Enforce in `src/lib/services/web-research.ts`:**
   - `researchProducts`: cache only the trusted products under `webfacts:v2`, and register only
     those (`registerProducts`). Return untrusted products to the requester with a new
     `sharedSource: false` flag. If nothing was trusted, cache nothing; the 10-minute failure
     marker is not set either, because the search didn't fail.
   - `researchAlternativeCandidates`: use and cache trusted products only.
   - `addProductToDynamicCache` and `rememberVerifiedProducts` also refuse `web_page` products
     from untrusted hosts, as a second check.
3. **UI.** On a product from an untrusted site, show 「ほかのサイトの情報です。成分はパッケージで
   確かめてください」 next to the source link (one line; no new colours).
4. **Clean up.** Version the KV keys (`webfacts:v3`, `altfacts:v2`) so old untrusted entries stop
   being read. On read, the verified index drops `web_page` products from untrusted hosts, and
   the next write removes them.
5. **Tests.**
   - A trusted product is cached and shared.
   - An untrusted product is returned but not cached or shared, and the browser's copy is used
     for that requester's analysis.
   - Untrusted products are never alternatives.
   - Subdomains match but look-alike hosts don't: `kao.co.jp.evil.example` and `evilkao.co.jp`
     are not trusted.
   - An http URL is not trusted.
   - Shadow mode logs the host only.

## Costs and trade-offs

- **Cost:** a query whose results are all untrusted is not cached, so each person who asks
  pays for the search again (about $0.19–0.29). The per-request, per-session and per-IP budgets
  still apply. Shadow mode shows how often this happens before enforcing.
- **Coverage:** small brands without their own site lose shared results until their shop is
  added to the list.
- **Upkeep:** the list needs occasional upkeep, and brand domains change rarely.

## Decisions for the owner

1. **Retailers.** Which retailers to trust at the start, or wait for the shadow-mode log
   (recommended).
2. **Alternatives.** Use trusted sites only (recommended, because those queries are the same for
   everyone), or also show untrusted alternatives with the note.
