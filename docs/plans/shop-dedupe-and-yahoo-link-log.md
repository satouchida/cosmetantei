# Plan: remove saved duplicates inside the shop search, and log why a 楽天 card has no Yahoo! link

Written 2026-11-23. Status: implemented 2026-11-23 (tests 213–214), not deployed.
Follows the live check of `8193f7a` (Cloudflare version `f5a03d6f`). See
[alternatives-live-review-2026-11-23.md](alternatives-live-review-2026-11-23.md).

These rules still hold:

- Code decides what is shown.
- The shops get only fixed words.
- There are no new paid calls.
- Logs hold counts and fixed words only.

## What the live check showed

「パラベンフリーの乳液」 showed two cards: ミノン (saved) and 松山油脂 (楽天).

- **Fewer cards than possible.** The shops were asked for two products (one saved card fitted). One of
  the two was the 楽天 listing of the saved ミノン milk. `findAlternatives` then dropped it as a
  duplicate, so one slot stayed empty, although other listings could have filled it.
- **The reply was one short.** It said 12 readable, 9 with irritants and 1 not a 乳液. The dropped ミノン
  listing was counted as neither a duplicate nor anything else.
- **No Yahoo! link** has appeared on any 楽天 card since `fbf39df`, and the log can't say why.

## Step 1. The shop search drops a listing of a saved card's product while it is still looking

**Change** (`shop-alternatives.ts`, `alternatives-service.ts`):

- `ShopAlternativeInput` gets `shownSaved: ProductIdentity[]`: the saved products that will be shown
  (`local` in `findAlternatives`). They stay in `exclude` too, for the cheap name-series check before
  reading.
- After a listing's ingredients are read (`consider`), a listing that `isSameProduct` matches with a
  saved card is dropped as `duplicate`. The search goes on, so another listing can take the slot.
  `found` and `enough()` only count products that can be shown.
- `duplicate` already means 「見つけた商品と同じ製品の別の出品」 in the reply, which is true here: the
  saved card is a product found.
- `findAlternatives` no longer needs its own saved-vs-shop filter after the shop call. The web-step
  path keeps its existing filter, which compares against the products that the web step saved.

## Step 2. Log why a 楽天 card has no Yahoo! link

**Change** (`shop-alternatives.ts`). `ShopSearchCounts` gets `yahooLink`:

```
yahooLink: { rakutenShown, linked, why: { noJan, noYahoo, set, name, variant } }
```

- `rakutenShown`: shown cards whose listing is 楽天's.
- `linked`: cards that got a Yahoo! link.
- `why`, for each 楽天 card without a link, the furthest step reached:
  - `noJan`: the 楽天 listing states no JAN code (not in its description, not in its name);
  - `noYahoo`: it states a JAN, but no Yahoo! item in the same search has that JAN;
  - `set` / `name` / `variant`: a Yahoo! item has that JAN, but it is a set, its name disagrees, or its
    variant marks differ (the same order as the 2b check).
- Counts only. No names, codes or JAN codes are logged.

`yahooTwin` returns its reason along with the twin. It is still one function, so the link and the count
can't drift apart.

## Not changing

- The Yahoo! matching rule stays the same. Step 2 is to find out, from real searches, which step fails
  before deciding whether a looser rule is safe.

## Tests

Next numbers from 213.

- 213 (step 1):
  - a 楽天 listing of a saved card's product is dropped while searching, and the next listing fills the
    slot;
  - `dropped.duplicate` counts it;
  - the reply's shortfall line includes it.
- 214 (step 2): the log counts for each reason, including `linked` for the 2b case and for a JAN carried
  by the listing.
- Update the tests that compare the whole `[alternatives]` line or `ShopSearchCounts` (164 and others).
- A mutation check for each step, the full gates, and a live check of 「パラベンフリーの乳液」 and two more
  searches, with the log line.

## Implementation notes

- Step 1 as planned. `shownSaved` is the saved products that can be shown
  (`fittingFirst(local, [], req, limit)`), not every saved product found, so a saved product hidden by the
  sub-kind rule doesn't block its own 楽天 listing. Test 213 runs the live ミノン case with the real 楽天
  name: the next listing takes the slot, and the reply counts the dropped one.
- Step 2 as planned. Test 214 covers every reason and `linked`, checks that the counts add up, and checks
  that no JAN code reaches the log. Test 164's expected line gains `yahooLink`.
- Each step's test fails with that step taken out.
- Review (code-improver): no Critical, High or Medium findings. Applied:
  - `listingCarriesJan` (2b) now uses `rakutenJans`, so the two can't disagree about which JAN a listing
    states.
  - Comments note that `duplicate` includes a listing of a saved card's product, and that a saved fill
    may not be shown when shop fits come first. That only affects the reply wording, never a card.
- Note from the review: `yahooLink.rakutenShown` counts before registered products are removed, like
  `shop.shown`. So it can exceed the cards on screen.
- Gates: `tsc`, `eslint`, `npm test` 214/214.
