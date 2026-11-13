# Splitting ChatContainer, part 2

Drafted 2026-11-11. Status: Steps 1–4 done (2026-11-13); Step 5 in progress. Part 1 (2026-11-11, package F of
[docs/review/2026-11-10-code-quality.md](../review/2026-11-10-code-quality.md)) moved the product
lists and import/export into `useRoutineLists`, `useRoutineTransfer` and `chat-helpers.ts`.

## Where we are

`src/components/chat/ChatContainer.tsx` is 1,368 lines; the component runs from line 86 to 1368.
It still holds 17 `useState`, 16 `useRef` and 5 `useEffect`, and four jobs:

| Job | Lines (about) | What it is |
|---|---|---|
| Typeahead: candidates, brands, brand line-ups | 128–215 | 4 states, 2 refs, `requestLineup`, one 44-line effect, the derived tray lists |
| Chat requests | 386–740 | `runChatAction` (66 lines), send, barcode, label, select, `handleQuickReply` (104 lines, 26 branches), differential, combination check; `busyRef`, `abortRef`, `retryRef`, `usedActions`, loading and announcement text |
| Page chrome | 104–112, 260–380 | toast, drawer open/close with its key handler and focus, consent focus, mobile viewport |
| Rendering | 766–1367 | 602 lines of JSX: live regions, header, mobile summary, stale banner, message list, input bar with the tray, drawer, eight dialogs |

The rendering block is the largest part and the least risky to move; the chat-request block is
the most tangled and the most valuable.

## Goal

`ChatContainer` becomes a composition root of about 150–200 lines: call the hooks, pass their
results to a handful of components. Each new file has one reason to change and stays under the
size cue (about 200 lines for a component, 300 for other files).

No behavior change in any step. The six fixes listed in
[docs/walkthroughs/2026-11-09-two-lists.md](../walkthroughs/2026-11-09-two-lists.md) must survive
every step, as in part 1.

## Steps

Each step is one commit, verified on its own (tests, `tsc`, lint, and the browser checks below).
Order: lowest risk first, so that the hard step (3) happens in a smaller file.

### Step 1. `useTypeahead` (hook)

`src/components/chat/useTypeahead.ts`: `liveCandidates`, `liveBrands`, `liveBrand`, `lineups`,
`lineupRequested`, `lineupRetryAt`, `requestLineup`, the search effect, and the derived values
the tray needs (`trayCandidates`, `lineupCredits`, tray visibility inputs). Takes `input` and
`consented`; returns what the tray renders.

Self-contained: it only reads the input text. About 120 lines move.

### Step 2. `usePageChrome` (hook)

`src/components/chat/usePageChrome.ts`: the toast (`toastMessage`, `toastKind`, timer,
`showToast`), the drawer (`isSidebarOpen`, `isMobileViewport`, `isDrawerModal`, `closeSidebar`,
the key handler with the `dialog[open]` guard, focus on open), and the consent focus effect.
Returns refs the JSX attaches (`menuButtonRef`, `drawerCloseRef`, `mainRef`, `inputRef`).

`showToast` is already needed before `useRoutineLists`, so this hook is called first.

### Step 3. `useChatRequests` (hook) and a quick-reply dispatcher

The core. `src/components/chat/useChatRequests.ts`: `messages`, `isLoading`, `loadingText`,
`announcement`, `alertText`, `usedActions`, `busyRef`, `abortRef`, `retryRef`,
`restoredInputRef`, `routineRef`, and `runChatAction`, `handleSendMessage`,
`handleBarcodeScanned`, `handleLabelSubmit`, `handleSelectProductToAnalyze`,
`handleRunDifferential`, `handleCheckCurrentUse`, the price / alternatives / research handlers,
and `appendLocalExchange`.

`handleQuickReply` (104 lines, a `switch` over the action kind) moves to
`src/components/chat/quick-reply-dispatch.ts` as a function that takes the action and an object
of the handlers it calls. It is a dispatcher, not state, so it does not belong inside the hook.
Give the `switch` an exhaustive `never` check so a new action kind fails to compile until handled.

What forces care here:

- `runChatAction` reads the lists **at press time** and, on retry, the latest lists through
  `routineRef`; `offerExportAfterResult` is called after the `await`. Keep both exactly.
- `busyRef` is read by handlers outside the hook (the tray, the sidebar buttons) to refuse a
  second request. Return it, or better, return one `isBusy()` function and use it everywhere.
- The hook needs `routine`, the list handlers and `offerExportAfterResult` from the two existing
  hooks. Pass them in as one object; do not reach across hooks through refs.

**Done 2026-11-13, with these differences from the plan:**

- `messages` stays in `ChatContainer` and is passed in: `useRoutineTransfer` reads it and
  `useChatRequests` needs that hook's `offerExportAfterResult`, so neither hook can own it without
  reaching into the other.
- `restoredInputRef` moved into `useTypeahead`, which returns `skipSearchFor(text)`; the request hook
  calls it instead of sharing a ref.
- The hook returns `isBusy()` and `abortRequest()` instead of the refs.
- So the dispatcher can be tested in Node, `QUICK_REPLY_ICON_COMPONENTS` moved to
  `quick-reply-icons.ts` (chat-helpers no longer imports lucide-react) and `DIFFERENTIAL_LABEL` to
  `routine/routine-labels.ts` (re-exported from `RoutineSidebar`). Test 158 now calls the dispatcher.

### Step 4. Components for the JSX

Pure presentation; props in, callbacks out. Each is added to `/dev/gallery` or to its
`notScreens` list (test 114).

| Component | Lines today | Contents |
|---|---|---|
| `ChatLiveRegions` | 773–816 | The toast and the screen-reader live regions |
| `ChatHeader` | 817–880 | Top bar: logo, scan and label buttons, menu button with its badge |
| `RoutineSummaryBar` | 885–956 | Mobile summary, the differential button, the stale banner |
| `MessageList` | 957–1100 | Messages, the cards inside them, quick replies, the loading row |
| `ChatInputBar` | 1101–1207 | The form, the tray, legal links |
| `ChatDialogs` | 1253–1362 | Scanner, label input, export, import, the two choice dialogs, the export reminder |

`MessageList` is the largest; if it passes about 200 lines, split out `MessageBubble` (one
message with its cards).

The drawer wrapper and `RoutineSidebar` (1208–1252) stay in `ChatContainer`: they are already one
component plus a wrapper `div`.

**Done 2026-11-13, with these differences from the plan:**

- `MessageBubble` was split out of `MessageList` from the start (seven components, not six).
- All seven are in test 114's `notScreens` list (they are parts of the chat screen, checked at
  `/`), not in `/dev/gallery`.
- `handleScanSuccess` and `handleSelectTrayProduct` were inline in the JSX; they are now named
  handlers in `ChatContainer`, passed down as props.
- `ChatContainer.tsx` is about 365 lines, above the 150–200 hoped for: hook wiring, the sample
  loader, those two handlers and the drawer wrapper remain.

### Step 5. Tests that read source text

Several tests read `ChatContainer.tsx` as text through `CHAT_CONTAINER_FILES`
(`tests/test_suite.ts`). Each step adds its new files to that list in the same commit; no
assertion is loosened. After Step 4, replace the brittle multi-line regexes that only pin code
shape (not behavior) with assertions on the extracted functions where possible, for example
calling the quick-reply dispatcher with fake handlers.

## What this buys

- A reader can find "what happens when I press a quick reply" in one 100-line file.
- The quick-reply dispatcher and `useTypeahead`'s derivations become testable without rendering
  the app.
- Changes to the layout no longer touch the request logic, and the reverse.

## Risks and how they are checked

- **Stale closures.** Moving handlers into hooks changes which render's values they close over
  only if a dependency is dropped. Rule for the implementer: move code, do not add or remove
  `useCallback` / `useMemo`, keep effect dependency arrays as they are.
- **Hook order.** Effects run in declaration order. Record the order before each step and keep
  it, or state why a swap is safe.
- **Focus.** The drawer, dialogs and the detail panel move focus on open and close. Check by
  keyboard after Steps 2 and 4.

Browser checks after every step (dev server): send a message, press a quick reply, open the tray
and register from it, load the sample and run the comparison and the combination check, open
and close the drawer at phone width with the keyboard, open each dialog, save and load an image.

## Out of scope

- Any change to what the app does or says.
- Server code. `handleQuickReply` on the client and the chat route's handlers stay separate.
