# Content Security Policy

Drafted 2026-11-11. Status: plan, not started. Follows finding V4 in
[docs/review/2026-11-10-code-quality.md](../review/2026-11-10-code-quality.md).

## Where we are

`next.config.mjs` sends one static policy on every response:

```
frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
```

It stops other sites from framing the app, plugins, a rewritten `<base>` and forms posting
elsewhere. It says nothing about which scripts may run, or where the page may load images from
or send data to. The comment in the file gives the reason: Next.js writes inline scripts into
every page, and a `script-src` without `'unsafe-inline'` would stop them.

No unsafe HTML sink exists in the code today (no `dangerouslySetInnerHTML`, `innerHTML`, `eval`),
so this is a second line of defense: it limits the damage if one is ever added, or if a
dependency is compromised.

## What the app needs to be allowed

Checked in the code on 2026-11-11.

| Need | Source | Directive |
|---|---|---|
| Next.js scripts and styles | Same origin, plus inline scripts and styles Next writes | `script-src`, `style-src` |
| Cloudflare Turnstile | `https://challenges.cloudflare.com/turnstile/v0/api.js` (script) and its challenge iframe | `script-src`, `frame-src` |
| Product photos | `*.rakuten.co.jp`, `*.yimg.jp`, `*.openbeautyfacts.org` (the three hosts the server already allow-lists in `shop-apis.ts` and `search-barcode-service.ts`) | `img-src` |
| The saved routine image and the label photo preview | `blob:` (`URL.createObjectURL`), `data:` (`canvas.toDataURL`) | `img-src` |
| API calls | Same origin only (`/api/...`). The browser calls no other host. | `connect-src` |
| Fonts | Self-hosted by `next/font` | `font-src` |
| Barcode scanner (html5-qrcode) | Camera stream; inline styles set from script; possibly a worker | `style-src`, `media-src`, `worker-src` |
| One inline `style` attribute | `ApiCredits.tsx` | `style-src` |
| Affiliate and source links | Plain navigations; CSP does not restrict them | — |

All four pages (`/`, `/privacy`, `/terms`, `/owner`) are **static** today
(`.next/prerender-manifest.json`). That matters for the choice below.

## The choice for scripts

Next.js 16 documents three ways (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`):

| Way | Blocks injected inline scripts | Cost here |
|---|---|---|
| **A. Static policy with `'unsafe-inline'`** | No | None. Pages stay static. |
| **B. Nonce set in `proxy.ts`** (Next 16's name for middleware) | Yes | Every page must be rendered on each request. No static pages, no CDN caching. On Workers that is CPU time on every page view, counted against the plan's per-request CPU limit. Not measured yet. |
| **C. Hashes at build time (`experimental.sri`)** | Yes | Pages stay static. Experimental; not verified with Turbopack or OpenNext on Workers. |

**Recommendation: do A now, then try C. Keep B as the fallback only if C does not work and the
owner accepts dynamic pages.**

A is worth doing even though it keeps `'unsafe-inline'`: the other directives are where most of
the gain is. With `connect-src 'self'` and a short `img-src` list, a script that did get
injected could not send what it read to another server, and with a `script-src` host list it
could not load a second-stage script from elsewhere.

## Step 1. A complete static policy (way A)

In `next.config.mjs`, replace the CSP value with (one line; shown wrapped):

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.rakuten.co.jp https://*.yimg.jp https://*.openbeautyfacts.org;
font-src 'self';
connect-src 'self';
frame-src https://challenges.cloudflare.com;
media-src 'self' blob: mediastream:;
worker-src 'self' blob:;
manifest-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
upgrade-insecure-requests
```

- In development only, add `'unsafe-eval'` to `script-src` (React needs it for dev tooling; the
  docs say production does not).
- Build the image host list from the same constants the server uses to accept image URLs, so
  the two cannot drift. If that import is awkward in `next.config.mjs`, keep the list in the
  config and add a test that compares it with `SHOP_IMAGE_HOSTS` and the Open Beauty Facts check.
- Update the comment at the top of `next.config.mjs`.

**Roll out in two deploys.**

1. Send it as `Content-Security-Policy-Report-Only` next to the current policy. Nothing is
   blocked; the browser console shows what would be. Walk through every screen (below) and fix
   the list.
2. When a full walk-through shows no violation, move it to `Content-Security-Policy` and drop
   the old value.

A reporting endpoint is not planned: it would collect URLs from users' browsers, which needs a
privacy-policy change, and the walk-through covers the same ground for an app this size.

**Walk-through (each must work with no CSP message in the console):**

- First visit: consent dialog, then Turnstile loads and a session starts.
- Search with the tray: product photos from Rakuten, Yahoo! and Open Beauty Facts show.
- Barcode scan with the camera, and from a picture file.
- Label input: take or choose a photo, preview, read.
- Save the routine as an image (canvas, QR code), share, and load it back.
- `/privacy`, `/terms`, `/owner`, the 404 page.
- Mobile width and desktop.

**Tests:** assert the header value in `next.config.mjs` contains each directive above, that
`script-src` lists no host other than Turnstile, and that `connect-src` is `'self'` only.

## Step 2. Try build-time hashes (way C)

A spike, not a commitment. On a branch:

1. Add `experimental: { sri: { algorithm: 'sha256' } }` to `next.config.mjs`.
2. Remove `'unsafe-inline'` from `script-src` (keep the Turnstile host).
3. `npx opennextjs-cloudflare build`, then `preview`, and run the Step 1 walk-through.

Questions the spike answers:

- Do the static pages run with no inline-script violation? (The docs' own example uses
  `script-src 'self'` with SRI, which suggests yes, but it is not stated for the inline data
  scripts Next writes.)
- Does it work with Turbopack and through OpenNext's bundling?
- Does Turnstile's script, which adds its own elements, still work?

If all three are yes: ship it, again Report-Only first. If not: stay on Step 1 and record what
failed here.

`style-src` keeps `'unsafe-inline'` either way. html5-qrcode and React set inline styles from
script, and removing it gains little compared with scripts.

## Step 3 (only if C fails). Nonces

`src/proxy.ts` generates a nonce per request, sets the header, and the root layout reads it
(`headers()`), which makes every page dynamic. Before choosing this, measure the CPU time of
rendering `/` on Workers and confirm the plan's limit leaves room. The owner decides whether the
extra protection is worth dynamic pages.

## Out of scope

- Trusted Types (`require-trusted-types-for`): worth a look after Step 2.
- Any change to what the server fetches; CSP only governs the browser.
