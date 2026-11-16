# Modern web guidance: seven small fixes

Drafted 2026-11-17. Status: done 2026-11-17. Source: an audit of the frontend against the
`modern-web-guidance` guides (dialog, scrollbars, motion, typography, forms, natural interactions).
No change to what the app does or says; these are presentation and input-hint fixes.

## Work split

Two workers, with no file in common. Neither edits `tests/`; each reports the test changes it
needs and the main session makes them.

### Package A: global styles and shared looks

Files: `src/app/globals.css`, `src/components/ui/design.ts`.

| # | Fix | Detail |
|---|---|---|
| 2 | Scrollbars | Use the standard `scrollbar-color` (thumb and track as CSS variables). Thumb at least 3:1 against `--color-surface` and white. Drop the 6px custom width (default width). Keep a `::-webkit-scrollbar` fallback only as the guide's fallback section describes. |
| 3 | Reduced motion for `.animate-fade-in` | Inside the rule, a `prefers-reduced-motion: reduce` variant that keeps the fade and drops the 4px slide. No global `animation-duration` override. |
| 5 | Scroll containment for modal dialogs | `dialog:modal { overscroll-behavior: contain }` and `dialog::backdrop { overflow: hidden; overscroll-behavior: contain }`. No `@supports` test, no `overflow: hidden` on `html`/`body`. |
| 6 | Pressed state for buttons | Add an `active:` style to each button look in `design.ts` (one step past the hover color). Text contrast stays at least 4.5:1. The busy look (`aria-disabled`) gets none. |

### Package B: components

Files: `src/components/**` except `ui/design.ts`, and `src/app/owner/page.tsx`.

| # | Fix | Detail |
|---|---|---|
| 1 | Disclosure marker | `IngredientAnalysisCard.tsx:276`: the `flex` summary has no triangle in Chrome and Firefox. Add a chevron icon (`aria-hidden`) that rotates when the `<details>` is open; no transition under reduced motion. |
| 4 | Font sizes in rem | `text-[15px]` → `text-[0.9375rem]`, `text-[13px]` → `text-[0.8125rem]` (20 places, 11 files). Same rendered size at the default setting. |
| 7 | Form hints and tooltips | Chat input: `enterKeyHint="send"`. Barcode number input: `enterKeyHint="search"`. Owner key: `autoComplete="current-password"`. Remove `title` where it only repeats the accessible name. `WebSearchBadge`: its `title` text must not be hover-only (see the worker's report for what was chosen). |

## Checks

- Each worker: `npx tsc --noEmit -p .`, `npx eslint src tests next.config.mjs`, `npm test`.
- Main session, after both: the three commands again, test edits if needed, then the browser:
  the disclosure opens and shows its chevron, a dialog opens and closes, a button shows its
  pressed state, scrollbars are visible, and the chat screen at phone width looks unchanged.
- One code-improver pass over the changed files.
