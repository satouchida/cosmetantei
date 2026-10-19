# Plan: look for ingredients in the shop APIs before reading web pages

Written 2026-10-19. Status: implemented 2026-10-19 (not yet committed).

## What the owner asked for

Before the paid web research (and the trusted-sites check), try Rakuten, Yahoo! and Amazon for
the product's ingredients.

Owner decisions (2026-10-19):
- **Rakuten list found:** when a Rakuten caption gives a usable list, answer with it right away
  and run the trusted-site research after the reply. That way the shared cache still fills for
  the next user.
- **Amazon later.** The Associates account (store ID `cosmetantei22-22`) is under review, and the
  Creators API (which replaced PA-API 5 in 2026) needs qualifying sales. Its product data doesn't
  normally include full ingredient lists either.

## Why these two shops, in this way

From the 2026-10-18 measurement ([alternatives plan](alternative-recommendations.md#step-2-measure-first-half-a-day-free)):

| Shop | Ingredients in item text | JAN code | What it is used for |
|---|---|---|---|
| Rakuten | 61% have an ingredient heading (`itemCaption`) | none | **ingredients**, read from the caption |
| Yahoo! | 3% (`description`) | 81% | **JAN code**, matched to saved, checked products |

Constraints:
- **Search terms:** the shops only ever get a brand name from our own brand list, plus a fixed
  category word (化粧水, 日焼け止め, …) when the query names one. Never text the user typed. The
  rest of the query is matched against item names here.
- **Rakuten terms:**
  - Art. 10 (9): Rakuten data is never stored anywhere shared. A list read from a caption is
    used **for that reply only**: it isn't cached, saved in the browser, or included in the
    routine image (`isShopListingProduct`).
  - Art. 10 (7): item names are shown as returned.
  - Art. 3 and 10 (4)(5): the item page is linked only through a Rakuten Affiliate link.
  - The Rakuten credit is shown with the product.
- **Seller text is untrusted.** A list cut off too early could make a product look free of an
  ingredient it contains. So a list is used only if it passes all three steps.

## How it works (`src/lib/services/shop-ingredients.ts`)

1. **Resolve the brand** from the query (`resolveBrand`). With no brand, or a brand alone, the
   shops are not asked.
2. **Search both shops** in parallel with 「<brand> <category>」. Rakuten returns `itemCaption`
   only for this call (`rakutenItemSearch(…, { caption: true })`). The lineup tray never gets
   captions.
3. **Match items:**
   - the brand matches;
   - every remaining word of the query is in the item name (listing noise such as 【公式】 or
     送料無料 is ignored);
   - sets and refills are skipped.
4. **Yahoo!:** an item's JAN code is looked up among saved products only: memory and the barcode
   KV cache, through `findSavedByBarcode`. There is no paid call.
5. **Rakuten**, up to 2 items:
   1. **Cut:** keep the text after the last 「変更後」, then the single 「全成分」/「成分」 block, up
      to the next heading (使用方法, 内容量, 広告文責, …) or the end. Zero or two or more blocks:
      skipped.
   2. **Parse** with `parseIngredientLabel`, then drop sentences, bare numbers and symptom words.
   3. **clef-flash:** one question per item, "is this an ingredient name?". Items called `other`
      with 75%+ confidence are dropped. Clef sees only the item names. The call skips the
      payload-logging gateway. If Clef is unavailable, the step-2 list is used; leftovers count
      as unrated, so the outcome errs towards "can't judge".
   4. **Fewer than 8 ingredients:** not used.
6. **In the search** (`searchCosmeticsLive`, step C):
   - If the shops find anything, it is returned right away.
   - If nothing found is a saved, checked product, `researchProducts` runs after the reply
     (`runAfterResponse`) and fills the shared cache from trusted sites.
   - If the shops find nothing, the web research runs as before.

Products read from a caption (`ingredientSource: 'shop_listing'`, id `shoptext_rakuten_<code>`):
- not "verified", so never alternatives;
- never offered for the AI rating, because the server doesn't hold them;
- price lookup refuses them, as for other products the server doesn't hold.

The card shows 「出典: 楽天市場の商品説明」 (an affiliate link only), 「販売ページの成分表示です。成分は
パッケージで確かめてください。」 and the Rakuten credit.

## Cost

- **Shop calls:** each product lookup makes one Rakuten and one Yahoo! call. These are free and
  counted in the site-wide 50/min budget for each shop.
- **Clef:** at most 2 clef-flash calls, about $0.00004 each.
- **Paid research:** a lookup Rakuten answers still runs the trusted-site research once, in the
  background, unless Yahoo! found a saved product. That costs the same as today, and the answer
  arrives sooner.

## Tests

Test 105:
- cutting (stop headings, 【変更後】, sets, no heading);
- the obvious-text filter and the Clef filter (item names only);
- the search terms sent to each shop;
- Yahoo! JAN matching to saved products;
- unaltered Rakuten names, and no Rakuten link without the affiliate ID;
- not shareable or persistable;
- no shop call for a brand alone or an unknown brand;
- the search returning shop results before web research.

## Later

- **Amazon:** once the Creators API is available, check whether it returns ingredients. If it
  does, add it as a third shop with the same rules.
- **Evaluate:** compare the cut + Clef result with a hand check of 20 captions before relying on
  it widely, as the alternatives plan's step 3 asks. Step 3 (alternatives from the shops) can
  then reuse `ingredientsFromCaption`.
