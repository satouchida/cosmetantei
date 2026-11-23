# Plan: a 「Yahoo!ショッピングで探す」 search link on alternative cards

Written 2026-11-23. Status: implemented 2026-11-23 (test 215), not deployed.
Follows [shop-dedupe-and-yahoo-link-log.md](shop-dedupe-and-yahoo-link-log.md). Its live log showed that
none of the 楽天 listings states a barcode (`yahooLink.why.noJan` for all nine 楽天 cards), so the
same-item Yahoo! link almost never appears.

**Owner's decision (2026-11-23):**

- Keep the strict barcode rule for the same-item link.
- Add a search link instead, like 「Amazonで探す」 and 「Qoo10で探す」.
- The privacy policy gets a minor edit, without asking users to agree again.

## Step 1. One search-word builder for the shop search links

`searchQuery` moves out of `qoo10-affiliate.ts` into `search-link-query.ts` as `shopSearchQuery`, with no
change in behaviour. Qoo10 and Yahoo! use the same words: brand plus cleaned name, first 4 words, and no
link for a placeholder or decoration-only name.

## Step 2. Yahoo!ショッピング search link

`yahoo-search-affiliate.ts`, built the same way as `qoo10-affiliate.ts`:

- The search page is `https://shopping.yahoo.co.jp/search?p=<words>`.
- The affiliate link is the ValueCommerce MyLink with Yahoo!'s ad ID
  (`sid=3784886&pid=892728177`, the same values as `YAHOO_AFFILIATE_LINK_TEMPLATE` in `wrangler.toml`).
  The search page goes into `vc_url`, encoded once more.
- There is no impression image (`<img>`). Data goes to ValueCommerce and Yahoo! only when the link is
  opened.
- `buildYahooSearchUrl` and `buildYahooAffiliateUrl` return null when no search words can be made.

## Step 3. Cards

`ProductSuggestionCard` (alternatives) and `AmazonAlternativeCard` get 「Yahoo!ショッピングで探す」 next
to 「Qoo10で探す」:

- `rel="sponsored noopener noreferrer nofollow"`;
- the same screen-reader name as the other links;
- inside the PR area only.

The search-results note names it: 「「Amazonで探す」「Qoo10で探す」「Yahoo!ショッピングで探す」は商品名での検索結果のページを開きます。…」.

## Step 4. Privacy policy (minor edit)

The ValueCommerce purpose line, §7 2., changes from 「Yahoo!ショッピングの販売ページおよびQoo10の検索結果のページの提示」
to 「Yahoo!ショッピングの販売ページ・検索結果のページおよびQoo10の検索結果のページの提示」.

- The data sent and the recipient are already listed, including 「遷移先ページのアドレス（商品名等の検索語を含みます）」.
- `LEGAL_REVISED` becomes 2026-11-23. `LEGAL_VERSION` (re-consent) stays.

## Tests

Next number 215.

- 215, the same checks as the Qoo10 test:
  - the MyLink value;
  - the search words;
  - no link for empty, placeholder or decoration-only names, and a lone surrogate doesn't throw;
  - the product name can't add parameters to the Yahoo! URL;
  - no impression image;
  - both cards render it with `sponsored` in the PR area, and the note names it;
  - the privacy line.
- Test 192's link count (screen-reader names) goes from 4 to 5.
- The gallery: both cards with the new link, at desktop and phone widths.

## Implementation notes

- Steps 1–4 as planned. The moved `shopSearchQuery` has the same body as the old `searchQuery`, checked
  with a diff. Test 215 fails if the card link, the ad ID or the privacy line is changed back.
- Tests 145 (Amazon card grid class) and 192 (5 links with screen-reader names) were updated.
- Gallery: both cards at desktop and phone widths. On the Amazon card, the Yahoo! button takes the full
  second row when 「価格を比べる」 and 「Qoo10で探す」 are both shown.
- Review (code-improver), fixed: the PR note on the alternatives card now also names 「楽天市場で見る」
  and 「Yahoo!ショッピングで見る」 (the buttons shown when the same item is found by barcode).
- Review, declined:
  - Hiding 「Yahoo!ショッピングで探す」 when 「Yahoo!ショッピングで見る」 is shown. The search link is the
    fallback for other sizes and sellers, and the barcode link rarely appears.
  - Rewriting the Amazon card's column-span expressions into one helper. They are correct for all 7
    combinations, and the review called this optional.
- Gates: `tsc`, `eslint`, `npm test` 215/215.
