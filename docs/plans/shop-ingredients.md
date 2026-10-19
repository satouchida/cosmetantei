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
   2. **Parse** with `parseIngredientLabel`, then drop sentences, bare numbers, symptom words and
      advertising words (「…配合」, 「無香料」, 「150ml」, 「日本製」, 「…成分」). If any step can't
      read part of the list safely, the whole list is rejected.
   3. **No clef-flash.** It was planned as a third step but removed after the Cloudflare test
      below: inside real lists it deleted real ingredients.
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
- **AI:** none. The shop step makes no AI call.
- **Paid research:** a lookup Rakuten answers still runs the trusted-site research once, in the
  background, unless Yahoo! found a saved product. That costs the same as today, and the answer
  arrives sooner.

## Tests

Test 105:
- cutting (stop headings, 【変更後】, sets, no heading);
- the obvious-text and advertising-word filter, with no AI call;
- the search terms sent to each shop;
- Yahoo! JAN matching to saved products;
- unaltered Rakuten names, and no Rakuten link without the affiliate ID;
- not shareable or persistable;
- no shop call for a brand alone or an unknown brand;
- the search returning shop results before web research.

## Evaluation on 20 real captions (2026-10-19)

Twelve brand + category queries (キュレル, ちふれ, ミノン, アネッサ, ビオレ, 肌ラボ, セザンヌ, ファンケル,
オルビス, イハダ) returned 20 Rakuten items that mention 成分. Their captions were read by the app's
reader and checked by hand against the caption. A local script loaded the keys from `.dev.vars`
without printing them, and no caption was written to disk. Clef was not part of this run, because
Workers AI is only available inside the Worker. These results are the code steps, which are also
what the app uses when Clef is unavailable.

| | First run | After the fixes below |
|---|---|---|
| Lists read | 11 | 14 |
| ... correct (hand check) | 4 | **14** |
| ... wrong or missing an ingredient | **7** | 0 |
| Rejected, no list in the caption | 7 | 5 |
| Rejected, variant lists (two shades) | 0 | 1 |
| Missed (list present, not found) | 2 | 1 |

The 7 wrong lists in the first run had:
- **Glued fragments (ちふれ):** a list with quantities and group labels was accepted as 15
  glued fragments (「保湿成分:BG 4.48%、…」).
- **A hidden last ingredient (肌ラボ ×2):** a footnote glued to it (「フェノキシエタノール*2種の
  ヒアルロン酸」) hid フェノキシエタノール.
- **A tail glued to the last item (ファンケル ×2):** a maker's address hid トコフェロール, and in the
  other case 水 was dropped.
- **A merged list (セザンヌ):** two shade lists became one.
- **A split name (every list with 1,2-ヘキサンジオール):** it was cut at 「1、2-」.

Fixes:
- **Quantity format:** strip quantities, 適量, 全量を100%とする and group labels.
- **Bracketed groups:** turn 「有効成分」 and 「その他の成分」 into the parser's form.
- **Names:** join 「1、2-」 back into one name, and strip footnotes after a name.
- **Shade lists:** reject lists that start with a variant label such as 【ホワイト】.
- **Stop words:** end the list at 「メーカー」, 「商品区分」 and the like after a space, and at
  「注意事項」 anywhere.
- **Glued text:** reject a list whose dropped item starts with a separate word (「水 メーカー…」).
- **Footnote legends:** drop items such as 「無表示は「その他の成分」」.
- **Bare 「成分」 heading:** accept it after a sentence, followed by a list (キュレル, ビオレ).

A code-improver review then hardened the fixes; all 20 real captions gave the same results
afterwards:
- **Group labels:** only known labels are removed (functional words such as 保湿, 防腐 or 乳化,
  followed by 剤 or 成分), so 「グリセリン防腐剤:」 never deletes グリセリン.
- **Digits in names:** they are not treated as quantities (ポリソルベート80, ナイロン-12). A
  leftover % rejects the list.
- **Stuck text:** the check also covers active ingredients.
- **Footnotes:** a list is rejected when a footnote hides a real name (「BG*メチルパラベン」).

Test 105 covers each format with made-up captions in the same styles.

Still missed, safely: 「…効果成分水、…」 (a heading glued to the previous word).

### clef-flash on Cloudflare (2026-10-19)

The real clef-flash model (remote Workers AI, through wrangler's platform proxy) was run on the
reader's output for 20 real captions, and on 20 hand-picked items.

- **Single items:** perfect. It dropped all 10 junk items (「保湿成分」, 「ヒアルロン酸配合」,
  「無香料」, 「150ml」, 「日本製」 and others) with 86–100% confidence, and kept all 10 hard real
  names (POE水添ヒマシ油, VP・スチレン共重合体エマルション, シュガースクワラン and others).
- **Inside real lists:** harmful. It removed real ingredients from 9 of 20 lists: トレオニン,
  イソロイシン and フェニルアラニン (ミノン ×2), TEA (肌ラボ), PET (セザンヌ ×2), カンテン and
  低強度カンテン末 (ファンケル ×2), and 常水 and DL-ピロリドンカルボン酸ナトリウム液 (イハダ).
  DL-ピロリドンカルボン酸ナトリウム液 was kept when asked on its own. The code filters alone
  had left no junk in any of these lists.
- **Its only useful removal:** 「成分水」, which was a doubled heading (「成分成分水、…」) hiding 水.
  The reader now strips a repeated 「成分」.

Decision: clef-flash is not used in the shop reader. Removing a real ingredient can make a product
look free of something the user reacts to, so the reader only drops what fixed rules can
recognise. The advertising words Clef caught on their own are now code rules. This also removes
the Workers AI call and its 1–3.5 s per list.


## Later

- **Amazon:** once the Creators API is available, check whether it returns ingredients. If it
  does, add it as a third shop with the same rules.
- **Alternatives:** step 3 of the alternatives plan (alternatives from the shops) can reuse
  `ingredientsFromCaption`, which has now been checked on 20 real captions.
