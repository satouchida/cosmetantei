# Plan: export マイルーティン as an image, import it back, share it

Written 2026-10-19. Status: implemented 2026-10-19 (`33682d8`).

## What the owner asked for

- Export マイルーティン as one image.
- Import that image when coming back in a new session. Today the 肌荒れ and 安全 lists live only
  while the page is open.
- Share the image on social media.
- The image shows a summary of what suits the user's skin, plus a QR code that carries all three
  lists. The user can switch the QR code off.
- Import works both from the saved file and from a posted image (owner's choice: "QR code + file
  data").

## Design

Everything happens in the browser. The server sees nothing new: no upload, no new API, no paid
call.

**The image** is a 1080×1350 PNG (4:5, fits Instagram, X and LINE), drawn on a canvas with the
page font and colours.
- Title 「コスメ探偵 マイルーティン」 and the date.
- 「気をつけたい成分（候補）」: the possible causes from the latest 差分分析 in this session, up to 5.
  Left out if no analysis has run.
- 「肌に合っていたコスメ」: the 安全 list (brand and name, up to 6, then 「ほか N点」).
- Counts for 肌荒れ and 今使っている. Products that caused a reaction are not named on the
  public image.
- When import data is on: the QR code with the caption 「コスメ探偵で読み込む」 and cosmetantei.app.
- Footer: 「成分を比べた候補です。医療的な診断ではありません。」

**The import data** is controlled by one switch, 「読み込み用のデータを入れる」, on by default.
Off means neither the QR code nor the file data is added, so the image is a picture only.
- **File data:** a PNG `iTXt` chunk `cosmetantei-routine` holding the three lists with
  ingredients and the dates each product was added. This restores one's own backup exactly.
  Social networks strip it.
- **QR code:** `https://cosmetantei.app/#r=<data>`, where `<data>` is the lists as
  `[id, brand, name]`, compressed with deflate-raw and written as base64url.
  - The part after `#` is never sent to a server.
  - It survives posting.
  - A phone camera opens the app straight to the import prompt.
  - Capped at 800 bytes so the code stays readable after a social network recompresses it. If the
    lists don't fit, the image says so and only the file data is added.

**Products that are never exported:** labels the user typed or photographed (`user_label`), as
with the browser's saved list. A note says how many were left out.

**Import:**
- **From a picked image:** 「保存した画像から読み込む」 reads the file data first; if there is none, it
  decodes the QR code with html5-qrcode, which the barcode scanner already uses.
- **From a link:** opening a `#r=` link, or scanning the QR with the in-app scanner, imports it
  too. The `#r=` part is then removed from the address bar.
- **Confirmation:** a dialog shows the counts and offers 「今のリストに追加」, 「置き換える」 or
  「やめる」. Nothing changes without a choice.
- **Validation:** everything read is untrusted. It goes through `isValidProduct`, a plain-text
  check on names, de-duplication, `MAX_ROUTINE_PRODUCTS` per list and dropping `user_label`.
- **Products from the QR code** come back as names only (no ingredients). When the server still
  has a product's ingredients, it uses them for analysis by id, as it does today. Otherwise the
  user can search for the product by name in the chat.

**Sharing:** 「共有する」 uses the Web Share API with the PNG file where the browser supports it
(phones). 「画像を保存」 downloads it everywhere.

## Pieces

- `src/lib/routine-share.ts` (pure, tested):
  - export and parse the file data;
  - encode and decode the share link;
  - read and write PNG `iTXt` chunks, with CRC-32.
- `src/lib/client/routine-image.ts`: canvas drawing, the QR code (`qrcode-generator`, one small
  dependency).
- `src/components/routine/RoutineExportDialog.tsx` and `RoutineImportDialog.tsx`.
- Sidebar: a 「バックアップ・共有」 section with 「リストを画像で保存・共有」 and a smaller text button 「保存した画像から読み込む」.
- `ChatContainer`:
  - the import handler (append or replace);
  - the `#r=` link on page load;
  - share links from the barcode scanner.
- Tests: round trips, an oversized or malformed payload, user labels excluded, a forged
  payload rejected.

## Later

- An endpoint that resolves product ids to ingredients on import, so name-only products show
  their status at once.
- Keeping the 肌荒れ and 安全 lists in the browser, like 今使っている.
