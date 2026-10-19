# コスメ探偵 (CosmeTantei)

A web app that finds which cosmetic ingredients may be behind a skin reaction. You list the
products that irritated your skin and the ones you use without problems. The app compares their
full ingredient lists, points out the likely causes, and suggests products without them.

- Production: https://cosmetantei.app (the URL is set in `src/lib/site.ts`).
- There is no login. Paid calls are protected by a Turnstile check and spend limits (see
  [Security and abuse limits](#security-and-abuse-limits)).
- It is not a medical diagnosis tool and gives no personal medical advice. Questions about your
  own skin, symptoms or treatment get a fixed reply that suggests seeing a dermatologist.
- The app UI is in Japanese. The code comments are mostly Japanese; the docs are in English.

## How it works

- **Next.js 16** (App Router), built with
  [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) and run as a **Cloudflare
  Worker**. `worker.ts` (the `main` in `wrangler.toml`) re-exports the OpenNext worker and adds
  the app's Durable Object.
- **Ingredient data:** [Open Beauty Facts](https://world.openbeautyfacts.org/) first, then web
  research: Cloudflare Web Search (the `AI` binding's `websearch`, with the `exa` and `linkup`
  providers) finds brand or shop pages and Gemini reads them (URL context). A product keeps its
  ingredients only if they come from a page that loaded, and the page is kept as its source. You
  can also paste an ingredient label or photograph it (Gemini transcribes, you check it).
- **Ingredient analysis** (`src/lib/analyzer/`): rule-based and runs without a model. It
  classifies ingredients against `src/lib/data/ingredients-db.ts` and compares the irritating and
  safe products.
- **Chat replies** (`src/lib/services/chat-replies.ts`): templates for search and analysis
  results. Short Gemini replies, with no tools, only explain the likely cause and answer
  ingredient questions with general facts.
- **Chat gate** (`src/lib/services/chat-gate.ts`): Cloudflare's **Clef** model (Workers AI) stops
  free conversation, prompt injection and personal medical questions before any Gemini call.
- **Gemini** runs through **Cloudflare AI Gateway**. The Gemini API key is stored in the
  gateway's Provider Keys, so the app only holds a gateway token, `CF_AIG_TOKEN`.
- **Shop prices and brand lineups:** Rakuten Ichiba and Yahoo! Shopping item search APIs when
  their keys are set, otherwise the shops' product pages.
- **Ingredients from the shops first** (`src/lib/services/shop-ingredients.ts`): before paid web
  research, Yahoo! JAN codes are matched to saved products and Rakuten captions are read (cut,
  cleaned, filtered by clef-flash). Rakuten lists are used for that reply only, under Rakuten's
  terms. [Plan](docs/plans/shop-ingredients.md).
- **Turnstile** checks the browser once and starts a signed session (`src/lib/server/session.ts`).
- **Routine image** (`src/lib/routine-share.ts`, `src/lib/client/routine-image.ts`): マイルーティン
  can be saved or shared as one PNG, entirely in the browser.
  - The PNG holds the lists (with ingredients) in its file data.
  - A QR code holds a `https://cosmetantei.app/#r=...` link with product ids and names. It still
    works after a social network strips the file data, and the `#` part never reaches the server.
  - Labels the user typed or photographed are never exported.
  - Design: [plan](docs/plans/routine-image.md).
- **Cloudflare bindings** (`wrangler.toml`):

  | Binding | Kind | Purpose |
  | --- | --- | --- |
  | `ASSETS` | Static Assets | `.open-next/assets` |
  | `APP_CACHE` | KV | Caching (Gemini replies, brand verdicts, barcode matches, search results, verified products) |
  | `AI` | Workers AI | Clef and Web Search |
  | `AI_RATE_LIMITER`, `SEARCH_RATE_LIMITER`, `PRICE_RATE_LIMITER`, `SESSION_RATE_LIMITER`, `SHOP_RATE_LIMITER` | Rate limiting | Per-IP limits (20, 60, 5, 10 and 6 a minute) |
  | `SPEND_CAP` | Durable Object `SpendCapObject` | Counts paid calls across all users |
  | `USAGE` | Analytics Engine, dataset `cosmetantei_usage` | Usage records (counts, tokens, time; no text) |

Without these bindings (`next dev`, tests) the code falls back to in-memory versions
(`src/lib/server/cloudflare.ts`).

## Configuration

### `[vars]` in `wrangler.toml`

These are public settings, committed to the repo. For local runs, `.dev.vars` can override them.

| Name | Purpose |
| --- | --- |
| `GEMINI_MODEL` | Gemini model name |
| `NEXT_PUBLIC_AMAZON_AFFILIATE_TAG` | Amazon Associates tag |
| `CLOUDFLARE_ACCOUNT_ID` | Account for the AI Gateway |
| `AI_GATEWAY_ID` | AI Gateway name (`cosmetantei-prod`; local runs use `cosmetantei-dev`) |
| `CHAT_GATE_MODE` | Clef chat gate: `enforce`, `shadow` or `off` |
| `SEARCH_FILTER_MODE` | Clef search-result filter: `off`, `shadow` or `enforce` (default `off`) |
| `TRUSTED_SITES_MODE` | Share web results only from trusted sites (`src/lib/data/trusted-sites.ts`): `off`, `shadow` (log hosts only) or `enforce` (default `off`; production `shadow`) |
| `SPEND_BUDGET_USD` | Global budget in USD as `day/month` (UTC), for Gemini, Workers AI and web search together |
| `SPEND_PER_CLIENT_USD` | Daily budget per IP (IPv6 per /48) and per session |
| `SPEND_PER_NEW_SESSION_USD`, `SPEND_NEW_SESSION_MINUTES` | Smaller daily budget for a Turnstile session until it is this many minutes old |
| `SPEND_PER_NETWORK_USD` | Daily budget per IPv4 /24 |
| `SPEND_PER_HOSTING_NETWORK_USD` | Daily budget per cloud or hosting network |
| `SPEND_TIGHTEN_AFTER_SHARE` | Share of the day budget after which the per-client limits tighten |
| `SPEND_TIGHTENED_PERCENT` | The percentage the per-client limits drop to after that |
| `SPEND_PER_MINUTE_WEB_SEARCH`, `SPEND_PER_MINUTE_GEMINI`, `SPEND_PER_MINUTE_WORKERS_AI` | Calls per minute, site-wide |
| `SPEND_PER_MINUTE_RAKUTEN_API`, `SPEND_PER_MINUTE_YAHOO_API` | Shop API calls per minute, site-wide |
| `SPEND_BACKGROUND_SHARE` | Share of the per-minute limits that non-urgent work (ingredient ratings, label translation) may use |
| `SPEND_PER_REQUEST_USD` | Estimated paid calls one request may reserve |
| `TURNSTILE_SITE_KEY` | Public site key of the Turnstile widget. Empty turns the session check off (per-IP budgets only) |
| `RAKUTEN_API_ORIGIN` | `Origin` sent to Rakuten; it must be the site registered in the Rakuten app, or Rakuten returns 403 |
| `RAKUTEN_AFFILIATE_ID` | Rakuten affiliate ID |
| `YAHOO_AFFILIATE_LINK_TEMPLATE` | ValueCommerce MyLink template (`{url}` is the product page) |

Optional settings read by the code but not set in `wrangler.toml`: `GEMINI_THINKING_LEVEL`,
`CLEF_MODEL_GATE`, `CLEF_MODEL_FILTER`, `CLEF_MODEL_BRAND`, `SPEND_PER_MINUTE_OPEN_BEAUTY_FACTS`,
`SPEND_CAP_ALLOW_MEMORY`, `AI_GATEWAY_LOG_PAYLOAD` and `COSME_AFFILIATE_LINK_TEMPLATE`.
`.dev.vars.example` and `.env.local.example` list the ones meant for local use.

### Secrets

Secrets are stored with `pnpm exec wrangler secret put <NAME>`:

| Name | Purpose |
| --- | --- |
| `CF_AIG_TOKEN` | AI Gateway authentication token (Gemini and Clef) |
| `TURNSTILE_SECRET_KEY` | Secret key of the Turnstile widget |
| `SESSION_SECRET` | Signs the session cookie. At least 32 characters |
| `RAKUTEN_APPLICATION_ID` | Rakuten Web Service application ID |
| `RAKUTEN_ACCESS_KEY` | Rakuten Web Service access key |
| `YAHOO_CLIENT_ID` | Yahoo! Developer Network client ID |

If `TURNSTILE_SITE_KEY` is set but `TURNSTILE_SECRET_KEY` or `SESSION_SECRET` is missing, the
paid routes return 503. Set both secrets before deploying the site key. Without the Rakuten or
Yahoo! keys, prices come from the shops' product pages.

**Never put secrets in `[vars]` or in an `.env*` file.** `opennextjs-cloudflare build` embeds
every `.env*` file, for all modes, into the Worker. For local runs, secrets go in `.dev.vars`
(copy `.dev.vars.example`; the file is git-ignored). Workers AI calls (Clef) always go to
Cloudflare, even in local development, so they are billed.

## Local setup

Requirements: Node.js 22.9 or later, and pnpm (`corepack enable`; `packageManager` in
`package.json` pins `pnpm@12.10.1`).

```sh
pnpm install
cp .dev.vars.example .dev.vars        # then fill in the values
cp .env.local.example .env.local      # optional, non-secret settings only
pnpm dev
```

`pnpm dev` runs `scripts/dev.mjs`. It loads `.dev.vars` into the environment, then starts
`next dev` on http://localhost:3001. Without `CF_AIG_TOKEN` the AI features can't call Gemini.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next dev server on http://localhost:3001; loads `.dev.vars` |
| `pnpm test` | Test suite, offline: `fetch` and Cloudflare bindings are stubbed (`tsx --conditions=react-server --test tests/test_suite.ts`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm build` | Next production build |
| `pnpm build:cloudflare` | Build the Worker into `.open-next/` |
| `pnpm preview` | Build output run locally in `workerd` |
| `pnpm deploy` | Build and deploy to Cloudflare (`opennextjs-cloudflare deploy`) |

### Version pins

`next` is pinned to **16.3.8**. With Next 16.4, the Worker returns 500 on every page because
OpenNext doesn't inline the new `preview-props.json` manifest
([opennextjs-cloudflare#1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355)).
Upgrade once that issue is fixed, then check that `pnpm preview` serves pages.

`eslint-config-next` stays on 16.4, because 16.3.8 doesn't work with ESLint 10. It doesn't
depend on the Next runtime.

## Security and abuse limits

There is no login, so the app limits what one visitor can spend. Details are in
[`docs/walkthroughs/2026-10-14-cost-tracking.md`](docs/walkthroughs/2026-10-14-cost-tracking.md)
and [`docs/plans/ai-call-limits.md`](docs/plans/ai-call-limits.md).

- **Same-origin only** (`src/lib/server/api-route.ts`): API routes refuse cross-site calls
  (`Sec-Fetch-Site`, `Origin`) and POSTs that aren't `application/json`. Each route caps its body
  size.
- **Turnstile session** (`src/lib/server/session.ts`): paid routes need a signed `__Host-session`
  cookie that lasts 24 hours. The browser gets it by passing Turnstile once (`POST /api/session`).
- **Per-IP rate limits:** the five rate-limiter bindings above.
- **Global spend cap** (`SpendCapObject`): one Durable Object counts every paid call. It enforces
  daily and monthly USD budgets and per-minute counts. A call over a limit is skipped and logged
  as `capped`.
- **Per-client daily budgets:** per IP, per IPv4 /24, per cloud network and per session. After
  half of the day's budget is spent, they drop to a smaller percentage.
- **Per-request cap:** one request reserves at most $0.30 of paid calls and starts no new paid
  call after 60 seconds.
- **Shop and Open Beauty Facts quotas:** brand lineups are limited per IP and per session;
  Rakuten and Yahoo! API calls and Open Beauty Facts searches are counted site-wide per minute.
- **Prompt hardening and output checks:** system instructions treat page and user text as
  untrusted data, and outputs are checked before they are shown.
- **No user text in logs:** usage records hold counts, hashes, status codes, tokens and time.
- **Headers:** security headers come from `next.config.mjs` and `public/_headers`.

## Deployment

Deploys are manual. Set the secrets first (see above), then:

```sh
pnpm run build:cloudflare
pnpm run deploy
```

- **Custom domain:** the `routes` entry for `cosmetantei.app` in `wrangler.toml` is **commented
  out**. Enable it once the domain's zone is in the Cloudflare account; deploying with it enabled
  before then fails. Then add `cosmetantei.app` to the Turnstile widget's hostnames. The widget
  also needs the `workers.dev` hostname if that address is used.
- **Rollback:** use Wrangler's `rollback` command (`pnpm exec wrangler rollback --help`).
- **CI** (`.github/workflows/ci.yml`) runs on pushes to `main` and on pull requests:
  `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`.
  It needs no secrets. It doesn't deploy.

## Docs

- [`docs/PROGRESS.md`](docs/PROGRESS.md): the status page: what's done and what's next.
- `docs/review/`: the original review findings.
- `docs/plans/`: implementation plans.
- `docs/walkthroughs/`: notes on finished changes.
