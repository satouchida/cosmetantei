# Walkthrough: source links and the web-search label (2026-10-13)

Phases 7 and 8 of [the Gemini role redesign](../plans/gemini-role-redesign.md#phases-7-and-8-2026-10-13-done).

## What the user sees

- **「出典」 on every product, alternative and analysis card** that has a source:

  | Where the ingredient list came from | Shown | Link |
  |---|---|---|
  | A web page that was read | the page's host, e.g. `kao-kirei.com` | the page (https only) |
  | Open Beauty Facts | 「Open Beauty Facts」 | the product page, from the barcode (the database's licence asks for attribution) |
  | The user's own label | 「パッケージの成分表示（入力）」 | none |
  | An AI estimate | 「AIによる推定」 | none |
  | The app's own data | nothing | — |

- **A 「Web検索」 badge** on products whose ingredient list was read from a web page.
- **Alternatives:**
  - the card is headed 「避けたい成分を含まないコスメ:」 instead of 「該当するコスメ」;
  - when any product came from web search, a note explains that the app read the page's full
    ingredient list and checked the ingredients itself, and asks the user to check the source
    and the package.

## How it works

| Part | Where |
|---|---|
| Source rule | `productSourceInfo` in `src/lib/product-source.ts`. Links are https only, with any user name or password in the URL removed. The Open Beauty Facts link needs an 8–14 digit barcode |
| UI | `ProductSourceLink` and `WebSearchBadge` in `src/components/chat/ProductSourceLink.tsx`, used by `ProductSuggestionCard`, `AmazonAlternativeCard` and `IngredientAnalysisCard` |
| Alternatives marker | The chat route adds `suggestionKind: 'alternatives'`. `ChatContainer` keeps only that exact value and passes `isAlternatives` to the card |
| Validation | `isValidProduct` also checks that `ingredientSource` is one of the 4 values and that `sourceUrl` is an http(s) string of at most 2048 characters. Products only ever had these values, so older products still pass |
| Producer cap | `web-research.ts` drops a `sourceUrl` over 2048 characters, so a product the app found never fails that validation when it is sent back in the routine |

## Tests

- **68:** the source rule for each source type:
  - https only, with `http:`, `javascript:` and bad URLs shown without a link;
  - credentials removed;
  - the Open Beauty Facts link and its barcode check;
  - the validation;
  - the alternatives marker on the chat reply.
- **69 (phase 8):** a medical, free-talk or injection message makes no web search, no shop API call
  and no Gemini call, even when Clef also picks the price or alternative intent and shop API keys
  are set.
- **Already covered:**
  - unconfirmed sources lead to nothing shown: 33, 52, 64, 65;
  - Exa failing falls back to Linkup: 50;
  - refusals before any call: 41–43;
  - user text is never a search query: 51, 63, 66.

## Live check (wrangler dev)

The chat API returned the source pages that the cards turn into links:

| Request | Result |
|---|---|
| 「香料が入っていない日焼け止めを探して」 | `suggestionKind: 'alternatives'`; ノブ UVミルクEX and UVローションEX (noevirgroup.jp), ミノン UVマイルドミルク (daiichisankyo-hc.co.jp), all `web_page` |
| 「キュレル 潤浸保湿 化粧水」 | 2 products from kao-kirei.com, each with its own product page and barcode |

**The cards were not checked in the browser.** Another Chrome extension blocked screenshots and
clicks on the page, and I stopped after three tries. The rendering is covered by the unit tests of
`productSourceInfo`, plus typecheck and lint. A quick look in the browser is still worth doing.

## Code review

`code-improver` found no Critical or High issues, and confirmed that a non-https `sourceUrl` never
becomes a link. All findings were confirmed and fixed:
- **Medium:** a web page URL over 2048 characters would have made the routine fail validation
  after the user added that product. The producer now drops such URLs.
- **Low:**
  - credentials in the URL are removed;
  - the full host is shown on hover;
  - links say they open a new tab (for screen readers) and have a focus ring and a larger hit area;
  - the badge no longer wraps or squeezes, and long brands are truncated on the alternative card;
  - the alternatives note uses the same rule as the badge.
