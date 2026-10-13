# Plan: prices from listed shops, ready for affiliate links (2026-10-13)

Follows [phase 4 of the Gemini role redesign](gemini-role-redesign.md#phases-3-and-4-2026-10-13-done),
which read prices from any page the web search returned.

## Goal

Prices come only from large EC and cosmetics EC sites that run affiliate programmes:

| Shop | Pages | How prices are read | Affiliate |
|---|---|---|---|
| 楽天市場 (with 楽天24) | `item.rakuten.co.jp/<shop>/<item>/` (楽天24: `item.rakuten.co.jp/rakuten24/…`), `www.rakuten.ne.jp/gold/<shop>/<page>`. Not `24.rakuten.co.jp` or shop top pages, which are listings | Rakuten Ichiba Item Search API when the keys are set: one call across Rakuten and one with `shopCode=rakuten24`. Otherwise web search plus a Gemini read of the product page | Rakuten Affiliate ID → `https://hb.afl.rakuten.co.jp/hgc/<id>/?pc=<url>&m=<url>` |
| Yahoo!ショッピング | `store.shopping.yahoo.co.jp/<store>/<item>.html` (and the old `paypaymall.yahoo.co.jp/store/<store>/item/<item>/`) | Yahoo! Shopping itemSearch v3 when the Client ID is set, otherwise the product page | ValueCommerce, through a link template |
| @cosme SHOPPING | `www.cosme.com/products/detail.php` | The product page (no public API) | Whichever ASP carries it, through a link template |
| Amazon.co.jp | — | **No prices.** The Associates agreement allows Amazon prices only from Amazon's own API (the Creators API, which replaced PA-API 5 in 2026 and needs qualifying sales first). | The existing search link with the Associates tag |

Every other site is ignored, even when the search returns it.

## Rules

- **Search terms:** the product name from `toProductSearchQuery` / `toPriceSearchQuery`, plus the
  shop's name for the web search. No user chat text goes to the search or to a shop API.
- **Never cached.** No KV write, no AI Gateway cache.
- **Checked in code:**
  - the URL is a product page of the listed shop;
  - whole yen from 100 to 100,000;
  - every word of the query is in the brand and name;
  - sets, bundles (×3, 2個セット), used items and samples are dropped, and so are API items out of stock;
  - at most 2 offers per marketplace, 6 in all, cheapest first.
- **Rate limits:** each API allows about 1 call per second per app ID. The two Rakuten calls are
  1.1 s apart, and a 429 is retried once after 1.1 s.
- **Keys** are secrets (`wrangler secret put`, `.dev.vars`). They are never logged. The Rakuten
  access key goes in a header, not the URL.
- **Affiliate IDs** are not secret and go in `[vars]`. Without one, the link is the plain product
  page. A malformed ID or template (not https, or not exactly one `{url}`) is ignored.
- **Disclosure:**
  - the card shows 「PR」 and a one-line note whenever a link on it is an affiliate link (景品表示法,
    stealth-marketing rule since 2023-10);
  - the order is by price only.
- **API credits:** the card shows the official Rakuten and Yahoo! credit snippets, verbatim,
  whenever it shows a price from that API.

## Configuration

| Name | Where | What |
|---|---|---|
| `RAKUTEN_APPLICATION_ID`, `RAKUTEN_ACCESS_KEY` | secret | Rakuten Web Service app (free) |
| `YAHOO_CLIENT_ID` | secret | Yahoo! Developer Network app (free) |
| `RAKUTEN_AFFILIATE_ID` | `[vars]` | e.g. `0ea62065.34400275.0ea62066.204f04c0` |
| `YAHOO_AFFILIATE_LINK_TEMPLATE` | `[vars]` | ValueCommerce MyLink: `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=…&pid=…&vc_url={url}` |
| `COSME_AFFILIATE_LINK_TEMPLATE` | `[vars]` | The ASP's deep-link format with `{url}` |
| `NEXT_PUBLIC_AMAZON_AFFILIATE_TAG` | `[vars]` | Already there (`cosmetantei-22`) |

## Out of scope

- **Amazon prices** through the Creators API: once the Associates account qualifies.
- **The Amazon Associates statement** (「Amazonのアソシエイトとして…」): due on the site once the
  account is approved.
- **Other shops** (LOHACO, マツキヨココカラ, etc.) can be added to `SHOPS` in `shops.ts` once they
  have a programme.
