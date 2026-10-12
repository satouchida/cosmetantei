# Walkthrough: ingredient label input, paste or photo (2026-10-12)

What was built for [the label input plan](../plans/label-input.md), and how it was checked.

## What the user sees

- **Entry points:** a 「成分表示を入力」 button in the header, and a 「📝 成分表示を入力する」 quick reply
  in the welcome message and when a barcode or product name isn't found.
- **The modal:**
  - 「写真を撮る」 opens the camera; 「画像を選ぶ」 picks an image;
  - a text box for the label, and optional product name and brand;
  - a note that photos are only used to read the ingredients and aren't saved.
- **A photo is transcribed into the text box,** with the message 「パッケージと見比べて、違うところがあれば直してから…」.
  Nothing is analysed until the user presses 「分析する」.
- **The result is the usual analysis card,** with the quasi-drug notes and JCIA links where they
  apply. 「肌荒れした」 and 「安全に使えている」 add the product to the comparison lists.

## How it works

| Part | Where | Notes |
|---|---|---|
| Photo → text | `POST /api/label/read`, `readLabelImage` in `src/lib/services/label-reader.ts` | Gemini, no tools, JSON `{found, text}`. Copies only the ingredient section, as printed; writes 「?」 for unreadable characters; puts a newline before 「有効成分」「その他の成分」; ignores instructions written in the image. Not cached; gateway payload logging stays off in production. `ai` rate limit |
| Photo checks | `parseLabelImage` | JPEG, PNG or WebP only. Base64 length is checked before decoding, at most 1.5 MB. The file's first bytes must match the declared type |
| Photo size | `LabelInputModal` | Resized in the browser to at most 1600 px, JPEG 0.85 (0.7 and 0.55 if still too big) |
| Text → product | `productFromLabel` | `parseIngredientLabel` → `ingredientSource: 'user_label'`, id `label_<hash>`, `labelFormat`. Returns `empty` when nothing parses, or `unsplit` when everything stays one name (no separators, or space-separated). The reply then asks for 「、」 between ingredients |
| Analysis | chat action `analyze_label` | `analyzeProduct` only. No Gemini, Clef or search call; the label text goes nowhere |
| Not shared | — | The product is never added to the shared product cache or the KV verified list, so it can't become someone else's alternative |
| Limits | `isValidLabelInput` in the chat route | Text 1–5,000 characters; name and brand at most 100 |

## Live test (wrangler dev, 2026-10-12)

The photo was a rendered quasi-drug label (`薬用美白ローション`), with usage text and a company name
below the ingredients.

| Check | Result |
|---|---|
| Photo transcription | 7.1 s. Exactly the 有効成分 and その他の成分 lines, including 1,3-ブチレングリコール, POE・POPラノリン and 他2成分; usage text and company name left out |
| Analysis of that text | 0.0 s, `warning`. Two actives tagged 有効成分. Notes: unordered 「その他の成分」 and 他2成分. Ethanol and fragrance flagged; グリチルリチン酸ジカリウム listed as soothing |
| 「・」-only paste | `水・BG・グリセリン・ジメチコン・アクリル酸アルキル・VA共重合体液・…` split into 7, with the copolymer kept whole |
| PNG declared, JPEG sent | 400 |
| In Chrome | The modal opened, the photo upload filled the text box with the review message, and the headings were on separate lines. The final click on 「分析する」 couldn't be automated, because another Chrome extension's overlay took over the tab. The same request was checked through the API above |

**Found by the live test:** in one run, Gemini wrote 「…ジカリウムその他の成分:精製水」 with no break.
The stricter heading rule from the last review missed that heading, which would have made every
ingredient an active. Fixed two ways:
- a heading followed by 「:」 now counts anywhere;
- the prompt asks for a newline before each heading.

Test 56 covers the run-on case.

## Code review

`code-improver` found 1 High, 4 Medium and 4 Low issues. All were checked against the code and
fixed:

| Severity | Finding | Fix |
|---|---|---|
| High | `MARK_LEGEND` had four `\s*` in a row. A 「※」 followed by spaces backtracked catastrophically: 800 spaces took 29 s (measured), and pasted text can now reach it | Whitespace runs are collapsed before parsing, and the regex uses `\s{0,3}`. 4,900 spaces now take 0 ms. Test 61 times it |
| Medium | A `user_label` product counts as verified, so one future call to `addProductToDynamicCache` or `rememberVerifiedProducts` would share it | `isShareable()` is checked inside both functions, and `findSafeAlternatives` skips user labels. `hasVerifiedIngredients` stays as is, because a user label is real label data; test 17 relies on that |
| Medium | The photo route read the whole body before checking its size | `Content-Length` is checked first: about 2 MB, otherwise 413 |
| Medium | The space-separated check ran only when the whole label was one item | Checked on every item, at 4+ words for Japanese and 6+ for English |
| Medium | A photo result could overwrite text typed meanwhile; closing didn't stop the request; the bitmap leaked on error | The text box is disabled while reading, closing aborts the request, `bitmap.close()` moved to `finally`, and files over 30 MB are refused |
| Low | A failed submit lost the text and showed nothing | The text is kept until the analysis succeeds, an error reply offers to retry, and a second submit while waiting is ignored |
| Low | Base64 of a non-canonical length was accepted | The length must be a multiple of 4 |
| Low | `AI_GATEWAY_LOG_PAYLOAD=true` would log photos | Photo requests always send `cf-aig-collect-log-payload: false` and `cf-aig-skip-cache: true` |
| Low | `/エタノール/` matched トリエタノールアミン | `ETHANOL_IN_LABEL` excludes ethanolamines and phenoxyethanol; the barcode service uses it too |

No second review pass: each fix is local and has its own test, and the live checks were re-run
after the fixes. Photo 10.0 s; analysis 0.05 s; the 4,900-space input answered in 0.00 s.

## Tests

- **61:**
  - builds a quasi-drug product from text; `empty` and `unsplit`, including a space-separated run
    inside a list;
  - ethanolamines aren't ethanol; parsing long whitespace is fast;
  - user labels never enter the shared cache or alternatives;
  - the chat action makes no external call; length and type limits return 400.
- **62:**
  - photo checks: type allow-list, magic bytes, size, canonical base64;
  - the Gemini request carries the image as `inlineData`, has no tools, turns off payload logging
    (even with the dev flag) and skips the gateway cache;
  - `not_found` and `unavailable`; an oversized body gets 413.
