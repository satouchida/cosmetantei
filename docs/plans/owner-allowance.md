# Owner allowance

Written 2026-11-07. The owner reached the per-visitor daily cap ($0.50, `SPEND_PER_CLIENT_USD`)
after five searches while testing. Raising that cap for everyone would let one visitor or bot use
more of the shared budget. Instead, only the owner's browser gets a larger cap.

## How it works

- A secret `OWNER_KEY` of at least 32 characters is set with `wrangler secret put`. Without it,
  the feature is off and `/owner` refuses every key.
- The owner opens `/owner` and types the key once. `POST /api/owner` compares it with `OWNER_KEY`
  using an HMAC check, so the comparison time doesn't reveal the key. On a match it sets the
  cookie `__Host-owner` (HttpOnly, Secure, SameSite=Strict, 30 days).
- The cookie holds only an expiry and an HMAC signature made with `OWNER_KEY`, never the key
  itself. Changing `OWNER_KEY` revokes every cookie issued before.
- Requests with a valid owner cookie are counted against one client, `owner`, with the daily cap
  `SPEND_PER_OWNER_USD` (default $5), instead of the IP, /24, cloud-network and session caps.
  That cap doesn't tighten when half the day's budget is used.
- Still applied to the owner: the Turnstile session, the global daily and monthly budget
  (`SPEND_BUDGET_USD`), the per-request cap ($0.30), the per-minute limits and the rate limiters.
- Key attempts share the session route's rate limiter. "外す" on `/owner` deletes the cookie.
- `/owner` is `noindex` and disallowed in `robots.txt`.
- A key shorter than 32 or longer than 512 characters, or with fewer than 12 distinct characters,
  turns the feature off. The key also signs the cookie, so someone holding a copied cookie could
  test guesses offline; a random key makes that impractical.
- Revoking: "外す" only clears the current browser. A copied cookie stays valid until it expires
  (30 days) or `OWNER_KEY` is changed, which revokes every owner cookie at once. Every owner cookie
  shares the one `owner` daily cap.

## Setup

1. Generate a random key (for example `openssl rand -base64 32`) and keep it in a password manager.
2. `pnpm exec wrangler secret put OWNER_KEY` and paste it.
3. Open https://cosmetantei.app/owner in your browser and enter the key.

## Privacy

Only a browser that entered the key gets the cookie. Visitors never receive it, and it holds
nothing about the person. The daily total is stored under the fixed key `owner`, the same way
per-visitor totals are stored (`spend-cap-core.ts`).
