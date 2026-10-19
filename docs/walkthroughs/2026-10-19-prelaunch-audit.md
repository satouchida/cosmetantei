# Pre-launch audit and hardening (2026-10-18 – 19)

The owner asked for a full pre-launch audit before going public on https://cosmetantei.app. Read-only
audits ran in parallel; fixes were applied centrally, then a final review gate.

| Area | Who | Result |
|---|---|---|
| Prompts and injection | prompt-engineer | 2 High, 4 Medium |
| LLM integration | llm-architect | 2 High, 3 Medium |
| Abuse, red team (static and local only, no production or paid calls) | penetration-tester | 2 High, 3 Medium |
| Secrets, CSP, XSS | security-auditor | no Critical/High; 1 Medium |
| UI failure states, accessibility | ui-ux-tester, accessibility-tester | fixed earlier the same day (`a6c8f5c`, `a96c709`) |
| Build, env, timeouts, CI | coordinator (the deployment-engineer agent was blocked by the permission classifier) | 3 items |
| SEO and launch metadata | seo-specialist | wrong domain, missing robots/sitemap/OG |

Verified clean: no secret in client code, client bundles or git history (only the text
`startsWith('AIza')` matched); every `/api/*` route goes through the session check and budgets; no
`dangerouslySetInnerHTML` or markdown rendering; links built from data are scheme-checked; no CORS
headers; logs carry counts, hashes and status codes, never user text.

## Fixed

**Shared-data poisoning** (three audits found it independently). A crafted query, a seller's title or
an attacker's page could put a fake ingredient list or brand verdict into caches every user reads.
- Search terms that look like instructions to the AI (`ignore`, `prompt`, `指示`, `無視`, jailbreak
  phrases, links, markup) never reach a search or page read. Seller titles go through the same check.
- A page's ingredient list is used only if every name is plain text with no instruction; otherwise the
  product is 「成分未確認」. Translations must be plain text too.
- The page-read instruction says ingredients come only from the page body, never from the search term.
- A verified product's ingredient list is never replaced by a different one under the same id (memory
  cache and the KV index).
- Brand verdicts are judged on the brand string alone (no product name, no search term), brands in
  `brands-jp.ts` are accepted without Clef, and "not a brand" is cached for 1 day instead of 90.

**Cost**
- One request may reserve at most $0.30 of estimated paid calls (`SPEND_PER_REQUEST_USD`) and starts
  no paid call after 60 s (the browser gives up at 90 s), enforced in `reserveSpend`.
- URL-context pages are estimated at 50k tokens (was 20k), so concurrent reads of large pages can't
  slip far past the budgets before settling.
- The AI Gateway cache is skipped on every Gemini call; results are cached in KV, and a cached failure
  (blocked/truncated answers are HTTP 200) no longer sticks.

**Free quotas shared by everyone**
- Brand lineups: 6 per minute per IP and per Turnstile session (`SHOP_RATE_LIMITER`), so one client
  can't use the shops' 50/min.
- Open Beauty Facts search: 10 per minute for the whole site (`open_beauty_facts` bucket), OBF's limit.

**Other hardening**
- Turnstile siteverify gets the browser's IP (`remoteip`).
- `/api/label/read` reads at most the size limit, whatever Content-Length says.
- Label photo: instructions in the system instruction; a copyright-blocked photo says "not found, type
  it in" instead of inviting paid retries.
- Gemini chat replies that promise safety or a cure, or contain jailbreak text, are replaced by the
  fixed reply.
- Static assets get nosniff, frame and HSTS headers (`public/_headers`); HSTS includes subdomains.
- Open Beauty Facts images only from its own https host; the Amazon link is checked to be https Amazon.

**Launch**
- cosmetantei.app everywhere: canonical, OpenGraph, sitemap, robots, the OBF User-Agent contact.
- `robots.txt` (no `/api/`), `sitemap.xml`, OG and Twitter image (rendered from the app icon).
- The workers.dev host sends `X-Robots-Tag: noindex`.
- Page copy no longer promises 「特定」 or 「安心」 (metadata, manifest, welcome message, header,
  comparison card, alternatives card, quick replies, drawer); it says "possible causes" and that it is
  not a medical diagnosis.
- Workers Logs on; CI runs `pnpm build`.

After a code review of these fixes: the per-request total is corrected when a call is refused or
settled (so it counts money spent, not worst-case estimates); hedged replies such as
「必ず安全とは限りません」 are no longer rejected; search terms are filtered by injection phrases, not
words like "System" that appear in real product names; harmless zero-width characters are stripped
from page ingredient names; brand lineups allow 20/min per IP (shared mobile and office IPs) and 6/min
per session; hashed static files are cached for a year.

## Final gate (surgeon-reviewer)

**SHIP**, on one condition, now met: the overwrite guard had blocked a translated (Japanese) label from
replacing the stored English one, so translated products would have stayed English for everyone.
A translation of the same label now replaces it in memory and in KV (test 100). Other findings:
the remaining 「特定」/「安心」 copy (fixed), a misleading comment about the index expiry (fixed), and
the $0.30 cap after the 2027-01-01 price doubling (on the PROGRESS watch list).

Tests 97–100; 100/100 pass. Typecheck, lint and build clean.

## For the owner to decide or do

1. **Custom domain:** add the cosmetantei.app zone to the Cloudflare account, uncomment `routes` in
   `wrangler.toml`, add cosmetantei.app to the Turnstile widget, then consider `workers_dev = false`
   (or a 301 to .app). **Done 2026-10-19:** cosmetantei.app is live; www.cosmetantei.app redirects
   to it (308, `next.config.mjs`). The domain is registered with every API the app uses (Rakuten
   among them) and contact@cosmetantei.app forwards to the owner. workers.dev stays on for
   development, with `X-Robots-Tag: noindex`. It is the same production Worker, so use there
   spends the production budgets and writes the production caches.
2. **Which sites to trust for shared data:** web results from any site can still enter the shared
   cache under their own id. Sharing only results from brand sites and major retailers (others kept
   for the requester only) would close this; it needs a list. The owner chose to do it:
   [plan](../plans/trusted-sites.md).
3. **Budget for new sessions:** a botnet with solved Turnstiles can still spend the $30/day budget
   ($100/month cap). Options: a smaller budget for brand-new sessions, a cap on new sessions per hour,
   and an alert when the day passes the tightening point. **Done 2026-10-19:** a session gets $0.30
   (`SPEND_PER_NEW_SESSION_USD`) until it is 30 minutes old (`SPEND_NEW_SESSION_MINUTES`), then the
   usual $0.50 in total. The issue time comes from the signed cookie, so it can't be backdated.
   It is never more than `SPEND_PER_CLIENT_USD`. A new session can afford one web lookup in its
   first 30 minutes; after the day's tightening point it is $0.09, too little for any lookup (aged
   sessions get $0.15, also too little). A cap on new sessions per hour and an alert are not done.
4. **Hard spend limit outside the app:** a budget alert or limit in Google AI Studio / AI Gateway as
   a backstop.
5. **Copy:** have someone check the wording against 景品表示法・薬機法.
6. **Old Gemini key:** `docs/review/03-other-upgrades.md` records that a real key was once in
   `.env.local` and may have shipped in an early build. The owner confirmed it is no longer in
   `.env.local` and will rotate it anyway.
7. **Later:** a nonce-based CSP (report-only first), a server-rendered about page for search engines,
   IPv6 /32 grouping for budgets.
