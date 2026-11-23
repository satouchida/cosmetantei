# Plan: 楽天's cleansing category and shop-name cleanup (live check of 2026-11-22, second round)

Written 2026-11-22. Status: implemented 2026-11-22 (tests 205–206; test 166 checks the genre).
Follows the live check of `0f3a413` (Cloudflare version `2ae89835`) after
[shop-search-reach.md](shop-search-reach.md). That plan's three fixes worked live. This check found four
more problems.

Rules from [alternative-search-improvements.md](alternative-search-improvements.md) still hold: code
decides what is shown, the shops get only fixed words, and there are no new paid calls.

## Step 1. Search 楽天's 「クレンジング」 category, not 「クレンジングジェル」

**Problem.** 「無香料のクレンジングバーム」 got 0 items from 楽天. The makeup-remover search uses 楽天
category `405100` (`SUB_KIND_SEARCH.cleanser.makeup_remover` in `shop-alternatives.ts`). 楽天's own
search page names `405100` 「クレンジングジェル」. Its parent 「クレンジング」 is `210450`, which holds
クレンジングバーム (`568343`), オイル (`405061`), ジェル (`405100`), クリーム, リキッド, シート, フォーム,
ミルク and ポイントメイクリムーバー. So every makeup-remover search has been limited to gels.

**Change.** Use `210450` for 楽天. Yahoo!'s `48902` is 「クレンジング」 already (its category page says so),
so it stays. Update the comment that says the IDs were checked, giving the date and what each ID is.

## Step 2. A sale banner at the start of a shop name

**Problem.** Raw 楽天 name:
「BLACK FRIDAYはP2倍+2品同時購入で50円OFFクーポン [★3営業日以内に出荷] POHO＋(ポホプラス) UV サン スティックタイプ 日焼け止め 14g (顔・からだ用) (SPF50+ PA++++) (ノンケミカル) (国内正規品)」.
The card showed the brand 「BLACK」 and a name starting 「FRIDAYは +2品同時購入で50円OFFクーポン …」, and
those words went into the Amazon search.

**Change** (`src/lib/search/listing-name.ts`):

- In `withoutSearchTags` (used for both the card name and the Amazon/Qoo10 words), remove a run of
  leading words that each contain a sale phrase: BLACK FRIDAY / ブラックフライデー, クーポン,
  〇円OFF / 〇%OFF, 同時購入, お買い物マラソン, スーパーSALE, ポイント〇倍 / P〇倍. Only at the start, and
  only if something is left.
- Display noise also drops:
  - square brackets holding shipping or sale words (「[★3営業日以内に出荷]」);
  - square brackets holding three or more words. These are search tags such as
    「[リップクリーム 高保湿 無香料]」 or 「[ワセリン ボディクリーム 保湿 敏感肌 乾燥肌]」. A shade such as
    「[01]」 or 「[01 ライトベージュ]」 stays;
  - round brackets holding only 国内正規品 or a shipping word (「(国内正規品)」, which showed as 「(国内 )」,
    and 「(メール便L)」).

## Step 3. A site or award name after the product

**Problem.** 「メンソレータム リップベビーナチュラル 無香料 リップクリーム アットコスメ」: the card and the
Amazon words end in 「アットコスメ」.

**Change.** `SEARCH_TAG` gets アットコスメ… and @cosme…, so the name stops before them, as it does for
「ランキング」 and 「受賞」.

## Step 4. Say when readable listings were other listings of a product already found

**Problem.** The body-lotion reply said 9 listings were readable but showed 2 cards, without saying why.
The other 7 were the same products listed by other shops (`dropped.duplicate: 7`).

**Change** (`alternatives-service.ts`): `ShopCheckSummary` gets `duplicate`
(`counts.dropped.duplicate`), and the shortfall reply adds
「N件は、見つけた商品と同じ製品の別の出品でした」. The reply gives counts only, no names.

## Not changing

- 「サーフィン 日焼け止め スティック ノンケミカル … COCOSUNSHINE ココサンシャイン …」: the brand line shows
  「サーフィン」. The real brand isn't in our brand list and the listing has no brand field, so code
  can't tell which word is the brand. This needs a brand-list entry or a brand field, which is separate
  work.

## Tests

Next numbers from 205.

- 205 (step 1): the makeup-remover search sends 楽天 genre `210450` and Yahoo! `48902`.
- 206 (steps 2 and 3): the POHO+ names (both sale variants), the bracket tags, 「(国内正規品)」 and
  「アットコスメ」 clean for display and for the Amazon words. Names that must stay whole: shades
  「[01]」 and 「[01 ライトベージュ]」, a name with クーポン in the middle, and a name that is only a sale
  phrase.
- 207 (step 4): the shortfall reply names the duplicate count. Without duplicates, the text is unchanged.
- Mutation check for each step, and the full gates.
- Live: 「無香料のクレンジングバーム」, 「ノンケミカルの日焼け止めスティック」, 「無香料のリップクリーム」 and
  「無香料のボディローション」, with the log line.

## Implementation notes

- Step 1 is checked by the existing sub-kind test (166), now expecting `210450`. Steps 2–3 are test 205,
  and step 4 is test 206. Tests 191 and 192 now expect 「アットコスメ」 dropped. Each step's test fails
  with that step taken out.
- Review (code-improver), fixed:
  - **Bracket rules were too broad.** `off`/`sale` matched inside words (`[Coffee Brown]`), and any 3-word
    bracket was dropped (`[N 21 ナチュラルベージュ]`). Now sale words must be sale phrases (〇%OFF, 〇倍,
    a standalone SALE). A 3-word bracket is dropped only if it also has a kind/form word
    (`withoutTagBrackets`). Shades stay: test 205 covers six.
  - **`duplicate` counted unread listings.** A listing whose JAN matched another *unread* listing was
    counted as a duplicate even if that product was never found, so the reply could claim
    「見つけた商品と同じ製品」. Now only a listing matching a **found** product is a duplicate. The rest
    count as `noList`. Test 206 runs this with real shop counts; test 170's expectation changed from 1
    to 0 for that case.
- Review, declined: sale text glued to the brand with no space (「クーポン配布中ケイト リップ」) loses the
  glued word. Shops separate banners with a space in every name seen so far; noted as a known limit.
- Gates: `tsc`, `eslint`, `npm test` 206/206.
