# Home screen design critique and fixes

Review of the home screen at https://cosmetantei.app (desktop, first visit with the consent
dialog open), done on 2026-10-21. The mobile layout was checked in the code, not in a browser.
Each finding has a plan with the files to change.

## Overall impression

The page feels calm and trustworthy: one sage-green palette, a clear "not a diagnosis" message,
and a short consent dialog with one button. The biggest problem is the main feature. The
differential analysis button (「原因候補の成分を絞り込む (差分分析)」) is the reason the app exists,
but it is far from the lists it needs, is described in jargon, and on phones it is hidden inside
the drawer. Barcode scanning, a secondary entry point, shows up four times.

## Corrections to the first pass

Checking the code turned up three points that the first, screenshot-only pass got wrong:

- **The analysis button is not lost in the scroll.** It is pinned to the bottom of the sidebar
  (`RoutineSidebar.tsx:298`) and turns `bg-primary` once a 肌荒れ product is added. The real
  problems are below in finding 1.
- **The footer links are 44px tall** (`LegalLinks`, `min-h-11`). The 20px links I measured are
  the inline links inside the consent dialog's sentence, which WCAG 2.5.8 exempts.
- **「画像で保存・共有」 is grey because it is disabled** while the lists are empty
  (`disabled={isEmpty}`), not because of its style.

## Findings

| # | Finding | Severity |
|---|---|---|
| 1 | The analysis button is hard to find and hard to understand | 🔴 Critical |
| 2 | Barcode scanning appears four times with three labels | 🟡 Moderate |
| 3 | The optional list comes before the two lists the analysis needs | 🟡 Moderate |
| 4 | The sidebar is named differently on desktop and phone (マイルーティン管理 / カルテ) | 🟡 Moderate |
| 5 | The image save and load buttons look the same and have similar labels | 🟢 Minor |
| 6 | The welcome message is three dense paragraphs | 🟢 Minor |
| 7 | The chips use emoji, everything else uses lucide icons | 🟢 Minor |
| 8 | Count badges are red, blue and green even when they show 0 | 🟢 Minor |
| 9 | The sidebar subtitle is cut off | 🟢 Minor |
| 10 | The affiliate disclosure is 11px and only visible in the sidebar | 🟢 Minor |
| 11 | The consent dialog shows the cookie name `__Host-session` | 🟢 Minor (optional) |

What works well, and should be kept:

- The consent dialog has short bullets and one button, and it says up front that the cookie is
  not used for ad tracking.
- The example chips name real products (キュレル, メラノCC), so users see right away what input
  works.
- The dashed empty-state boxes explain each list instead of only showing 0.
- All header buttons and row buttons are at least 48px tall. `lang="ja"`, the heading order and
  the 「入力欄へ移動」 skip link are correct.

---

## 1. Make the analysis button easy to find and understand 🔴

**Problem**

- Desktop: the lists sit at the top of the sidebar and the button is pinned to the bottom. In
  between are the scan and image buttons and, on a tall screen, a large gap. Nothing tells
  the user that the lists feed the button.
- Phone: the button exists only inside the drawer (「カルテを開く」). After adding products in the
  chat, phone users have no visible way to run the analysis.
- The label 「…(差分分析)」 is developer language. When disabled, the button reads as dead grey,
  and one line of hint text is all that explains why.

**Plan**

1. Rename the button to 「肌荒れの原因候補を調べる」 (`RoutineSidebar.tsx:308`). Keep the
   wording inside the legal review's limits: 「原因候補」, never 「原因」 alone.
2. Replace the disabled hint (`RoutineSidebar.tsx:310-314`) with a two-step checklist that shows
   progress:
   - `① 肌荒れしたコスメ 0/1点` (required, check mark when done)
   - `② 普段使えているコスメ 0点（任意・あると候補を絞り込めます）`

   Keep `id="differential-hint"` so `aria-describedby` still works.
3. Phone: in the status bar above the chat (`ChatContainer.tsx:1139-1158`), once
   `routine.badProducts.length >= 1`, show a primary button 「原因候補を調べる」 next to the
   counts. It calls the same handler as the sidebar's `onRunDifferential`. Keep the
   drawer-opening button, renamed in finding 4.
4. Run `grep -rn "差分分析" src tests` to find any other place that shows the old label to
   users. The hits in `route.ts` are comments and can stay.

**Check:** with 0 products, the checklist shows the button as disabled. After one 肌荒れ product
on a phone-width viewport, the status-bar button runs the analysis without opening the drawer.

## 2. Remove the duplicate barcode buttons 🟡

**Problem:** scanning is offered in the header (「バーコード読取」), in the welcome chip
(「📸 バーコードをスキャンする」), as the sidebar button 「JANバーコードをスキャン」, and as the camera
button in the input bar. They all open the same scanner (`setIsScannerOpen(true)`).

**Plan**

1. Remove the sidebar button (`RoutineSidebar.tsx:250-257`), the `onOpenScanner` prop and the
   value its caller in `ChatContainer.tsx` passes in. Also remove the unused `Barcode` import.
2. Keep the header button (desktop label, icon-only on phones), the input-bar camera and the
   chip. On phones the header button is icon-only, so the chip still helps people find it.
3. Use the same verb everywhere: change the sidebar empty-state text (`RoutineSidebar.tsx:203`)
   from 「…バーコードをスキャンして追加」 to 「…バーコードを読み取って追加」, which matches
   「バーコード読取」. Leave the chip strings as they are. `getQuickReplyAction` matches them with
   `includes('バーコード')`, so they could be renamed, but keeping them avoids churn.

**Check:** the scanner still opens from the header, the camera button and the chip, and
typecheck and lint pass.

## 3. Put the required lists first 🟡

**Problem:** 「今使っているコスメ」 (an optional feature that checks combinations) comes first,
above the two lists the analysis needs.

**Plan:** in `RoutineSidebar.tsx`, move the 今使っている `<section>` (lines 113-191) below the
普段使えている section (after line 247). Order: 肌荒れした → 普段使えている → 今使っている. The
stale-entry banner in the chat (`ChatContainer.tsx:1162`) opens the drawer, so it should also
scroll the 今使っている section into view: add an `id` to the section and call
`scrollIntoView` after the drawer opens.

## 4. Use one name for the sidebar 🟡

**Problem:** desktop calls the sidebar 「マイルーティン管理」 (`RoutineSidebar.tsx:82`), but the
phone button calls it 「カルテを開く」 (`ChatContainer.tsx:1156`). 「カルテ」 is also a medical
word, and the legal review (医師法・薬機法) worked to avoid medical framing.

**Plan:** call it 「マイルーティン」 everywhere. Heading: 「マイルーティン」. Phone button:
「マイルーティンを開く」, or 「リストを開く」 if it doesn't fit at 360px. Update the close button's
`aria-label` (`RoutineSidebar.tsx:103`) to match. Run `grep -rn "カルテ" src` to catch comments
that describe the UI.

## 5. Tell the image save and load buttons apart 🟢

**Problem:** 「画像で保存・共有」 and 「画像から読み込む」 sit side by side in the same tonal style,
so it is unclear which one exports and which one imports.

**Plan** (`RoutineSidebar.tsx:260-277`)

1. Rename them to 「リストを画像で保存」 and 「保存した画像から復元」.
2. Keep the save button tonal. Make the load action a smaller text-style button below it
   (`min-h-11`, `text-sm text-ink-muted`, underline on hover), because restoring is rare.
3. Check `docs/plans/routine-image.md` and `RoutineExportDialog`/`RoutineImportDialog` for the
   same labels and keep them in sync.

## 6. Shorten the welcome message 🟢

**Problem:** the welcome bubble (`ChatContainer.tsx:203`) is three paragraphs, about 230
characters, before the user sees the chips.

**Plan:** cut it to two short paragraphs. Keep the medical disclaimer and the PR wording, which
came from the legal review (commits `6367de1`, `c93db46`). Draft:

> 🔍 肌荒れの原因になりうる成分の候補を調べるサービスです。化粧品名を入力するか、バーコードを読み取ってください。
>
> 肌荒れしたコスメと普段使えているコスメを比べて候補を絞り込み、その成分を含まない商品（販売ページへのリンク付き。PR）を探します。医療上の診断ではありません。肌に異常があるときは皮膚科専門医にご相談ください。

Have the new wording checked against `docs/review/legal-review-by-gemini.md` before shipping.

## 7. Replace the emoji in chips with lucide icons 🟢

**Problem:** the quick-reply chips start with emoji (📸📝🧴💧⚡️🔍…), but the rest of the UI uses
lucide line icons. Emoji also render differently on each OS.

**Plan:** change only how the chips look. The label strings are keys in `ACTIONS`
(`quick-replies.ts`) and `QUICK_REPLY_INTENTS` (`chat-gate.ts`), so they must not change.

1. In `quick-replies.ts`, add `splitQuickReplyIcon(label)`, which returns
   `{ icon: LucideIcon | null, text: string }` from a table of leading emoji:
   📸→`Camera`, 📝→`FileText`, 🔍/🔎→`Search`, 🧴/💧→`Droplet`, ⚡️→`Zap`, 🚨→`AlertTriangle`,
   ✅→`CheckCircle2`, 💴→`JapaneseYen`, 🔁/🔄→`RotateCcw`, 💡→`Lightbulb`. Match ⚡ with and without
   the variation selector U+FE0F.
2. In the chip renderer (`ChatContainer.tsx:1262`), render `<Icon className="w-4 h-4" aria-hidden />`
   followed by `text`. Keep passing the full `qr` to `handleQuickReply`.
3. Add a test that every label in `ACTIONS` and `QUICK_REPLY_INTENTS` returns an icon.

## 8. Make empty count badges neutral 🟢

**Problem:** 「0点」 shows in sky, rose and green. A red 0 next to 肌荒れ looks like an error.

**Plan:** in `SectionHeading` (`RoutineSidebar.tsx:321-340`), use
`bg-surface-container text-ink-muted` when `count === 0`, and `countClassName` otherwise.

## 9. Fix the cut-off sidebar subtitle 🟢

**Problem:** 「コスメを登録して、原因になりうる成分の候補を比較で絞り込み」
(`RoutineSidebar.tsx:85`) is cut to 「コスメを登録して、原因になりう…」 in the 320px sidebar.

**Plan:** shorten it to 「比べて原因候補を絞り込みます」, or replace `truncate` with `line-clamp-2`.
Shortening is better, because the header row has a fixed height (`min-h-14`).

## 10. Make the affiliate disclosure readable and always visible 🟢

**Problem:** `AFFILIATE_DISCLOSURE` is 11px (`text-[11px]`, `RoutineSidebar.tsx:315`) and sits
in the sidebar's pinned bar. On phones it only appears when the drawer is open, even though PR
links appear in the chat.

**Plan:** move it under `LegalLinks` at the bottom of the chat (`ChatContainer.tsx:1422`) as
`text-xs text-ink-muted`, at full chat width, and remove it from the sidebar. The pinned bar
then holds only the analysis button and its checklist, which also helps finding 1. Check the
ステマ規制 notes in `docs/legal/` first: if the review asked for the disclosure to sit next to the
buy links, keep a copy there too.

## 11. (Optional) Simplify the cookie line in the consent dialog 🟢

**Problem:** the monospace cookie name `__Host-session` is technical for consumers.

**Plan:** only if the legal notes allow it, change the bullet in `ConsentDialog.tsx` to
「ボット対策と利用回数の上限の管理のため、24時間で消える Cookie を1つ使います」 and leave the cookie
name in the privacy policy. If the 外部送信規律 review wanted the name shown here, skip this.

---

## Suggested order

1. Findings 1, 2, 3, 4 and 10, as one change set: they all touch the sidebar's structure.
2. Findings 5, 8 and 9 (small sidebar polish).
3. Finding 6 (needs a legal wording check).
4. Finding 7 (touches chip rendering, add the test).
5. Finding 11 (optional, legal first).

After each set: `pnpm typecheck`, `pnpm lint`, `pnpm test`, then check desktop and 390px
widths in the browser. The test pass needs consent accepted: accept it yourself in the browser,
or clear the consent value in `src/lib/consent.ts` storage between runs.

## Status (2026-10-21)

Findings 1–10 are implemented. Where the code differs from the plan above:

- **1:** the button label is the shared constant `DIFFERENTIAL_LABEL` in `RoutineSidebar.tsx`.
  The chat messages and the toast that used to mention 「差分分析」 now name the button. On
  phones, the run button sits on a second full-width row of the status bar, so the counts don't
  get squeezed at 360px.
- **4:** the phone button reads 「マイルーティン」 with a chevron, not 「マイルーティンを開く」, to
  leave room for the counts.
- **5:** the save button keeps 「・共有」 (「リストを画像で保存・共有」) to match the export dialog's
  title. The load button says 「保存した画像から読み込む」 to match the import dialog's verb.
- **7:** `splitQuickReplyIcon` returns an icon *name*. The lucide components are chosen in
  `ChatContainer.tsx`, because the tests import `quick-replies.ts` under the `react-server`
  condition, where lucide-react fails to load (`createContext is not a function`).
- **10:** the disclosure is at the end of the conversation, not fixed under the input. Pinned
  there, it would take about five lines on a phone screen. At the end of the conversation it is
  visible on first view and stays next to the latest replies, which is where PR cards appear.
- **11:** not done. The consent dialog is where the cookie (外部送信) is announced, and
  `docs/legal/connected-services.md` chose to name the cookie publicly. Leave it for a legal
  decision.
