# Plan: ingredient label input (paste or photo)

Written 2026-10-12. Status: done on 2026-10-12 ([walkthrough](../walkthroughs/2026-10-12-label-input.md)).

## Why

Product lookups find a product only when Open Beauty Facts or a web page has its label. Many
Japanese products, quasi-drugs especially, have neither. Bulk-copying other databases isn't an
option: JCIA's list needs permission, and cosmetic-info.jp blocks AI agents in `robots.txt`. The
user usually has the product in hand, so let them give us the label.

## What the user does

1. Opens 「成分表示を入力」: a button in the header, next to the barcode scanner, and a quick reply
   when a barcode or name isn't found.
2. Either pastes the label text or takes or chooses a photo of it. A photo is transcribed into the
   same text box, and the user checks and corrects it there before anything is analysed.
3. Optionally adds the product name and brand.
4. Presses 「分析する」. The result is the usual analysis card, and the product can be added to the
   肌荒れ and 安全 lists like any other.

## Design

| Part | Decision | Why |
|---|---|---|
| Analysis | Server parses the text with `parseIngredientLabel` and runs `analyzeProduct`. No AI call | Deterministic, free, fast. Quasi-drug labels already handled |
| Product | Built on the server: `ingredientSource: 'user_label'`, id `label_<hash>`, `labelFormat` | Same validation and limits as other products |
| Sharing | A user's label is **not** added to the shared product cache or the KV verified list, and never becomes someone else's alternative | It's one person's unchecked input |
| Photo | Gemini (no tools) transcribes only the ingredient section, as printed, as JSON. The text comes back to the browser for review; it is never analysed directly | OCR mistakes are visible and correctable |
| Photo size | Resized in the browser to at most 1600 px, JPEG. The server accepts JPEG, PNG or WebP up to 1.5 MB | Cost and upload time |
| Privacy | Photos and label text aren't stored or cached. Gateway payload logging stays off in production (existing setting). The label text isn't sent to Gemini, Clef or any search | Labels can be in photos with other things in frame |
| Limits | Label text at most 5,000 characters; name and brand at most 100 each. Photo reading uses the existing `ai` rate limit | Same bounds as the rest of the API |

## Steps

1. Gemini client: image parts.
2. `label-reader.ts`: photo → text (Gemini), and `productFromLabel()`: text → `Product`.
3. API: `POST /api/label/read` (photo) and the chat action `analyze_label` (text).
4. UI: `LabelInputModal`, header button, quick replies.
5. Tests, then a live test with `wrangler dev` (paste, and a rendered label photo).
6. Code review, walkthrough, `PROGRESS.md`.
