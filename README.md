# コスメ探偵 (CosmeTantei)

A web app that finds which cosmetic ingredients may be behind a skin reaction. You list the
products that irritated your skin and the ones you use without problems. The app compares their
full ingredient lists, points out the likely causes, and suggests products without them.

It doesn't give personal medical advice. Questions about your own skin, symptoms or treatment
get a fixed reply that suggests seeing a dermatologist.

## How it works

- **Next.js 16** (App Router), deployed to **Cloudflare Workers** with
  [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare).
- **Ingredient data:** [Open Beauty Facts](https://world.openbeautyfacts.org/) first. Gemini is
  used for product research, and its estimates are labelled.
- **Ingredient analysis** (`src/lib/analyzer/`): rule-based and runs without a model. It
  classifies ingredients against `src/lib/data/ingredients-db.ts` and compares the irritating and
  safe products.
- **Chat gate** (`src/lib/services/chat-gate.ts`): Cloudflare's **Clef** model stops free
  conversation, prompt injection and personal medical questions before any Gemini call.
- **Gemini** runs through **Cloudflare AI Gateway**. The Gemini API key is stored in the
  gateway's Provider Keys, so the app only holds a gateway token, `CF_AIG_TOKEN`.
- **Cloudflare bindings** (`wrangler.toml`):
  - KV `APP_CACHE` for caching;
  - two rate limiters;
  - Workers AI (`AI`) for Clef.

## Setup

Requirements: Node.js 22.9 or later, and pnpm (`corepack enable`; the version comes from
`packageManager` in `package.json`).

```sh
pnpm install
cp .dev.vars.example .dev.vars        # then fill in the values
cp .env.local.example .env.local      # optional, non-secret settings only
```

**Secrets go in `.dev.vars` only.** Never put `CF_AIG_TOKEN` in an `.env*` file:
`opennextjs-cloudflare build` embeds every `.env*` file, for all modes, into the Worker.

| Where | `CF_AIG_TOKEN` and the gateway settings |
| --- | --- |
| `pnpm dev`, `wrangler dev`, `pnpm preview` | `.dev.vars` (uses the `cosmetantei-dev` gateway) |
| Production | `pnpm exec wrangler secret put CF_AIG_TOKEN` (uses `cosmetantei-prod` from `wrangler.toml`) |

Workers AI calls (Clef) always go to Cloudflare, even in local development, so they are billed.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next dev server on http://localhost:3001; loads `.dev.vars` |
| `pnpm test` | Test suite (offline: network calls are stubbed) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm build` | Next production build |
| `pnpm build:cloudflare` | Build the Worker into `.open-next/` |
| `pnpm preview` | Build output run locally in `workerd` |
| `pnpm deploy` | Build and deploy to Cloudflare |

CI (`.github/workflows/ci.yml`) runs install, typecheck, lint and tests on every push and pull
request.

### Version pins

`next` is pinned to **16.3.8**. With Next 16.4, the Worker returns 500 on every page because
OpenNext doesn't inline the new `preview-props.json` manifest
([opennextjs-cloudflare#1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355)).
Upgrade once that issue is fixed, then check that `pnpm preview` serves pages.

`eslint-config-next` stays on 16.4, because 16.3.8 doesn't work with ESLint 10. It doesn't
depend on the Next runtime.

## Docs

- [`docs/PROGRESS.md`](docs/PROGRESS.md): what's done and what's next.
- `docs/review/`: the original review findings.
- `docs/plans/`: implementation plans (Gemini web-research redesign, Clef gate and search filter).
- `docs/walkthroughs/`: notes on finished changes.
