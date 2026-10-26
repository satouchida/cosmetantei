# Launch readiness: spend protection, cap UX, bug reports, terms and privacy

Written 2026-10-26. Status: steps 2–5 implemented 2026-10-26 (not committed), tests 128 and 129.
Step 0 is waiting on the owner; step 1 decided (keep `10/100`). Based on the local to-do list
`docs/launch-todo.md` (gitignored), sections 1, 2, 4 and 5.

Owner decisions taken 2026-10-26: keep `SPEND_BUDGET_USD = "10/100"`; the contact address is
`contactme@cosmetantei.app` (`CONTACT_EMAIL` in `src/lib/site.ts`). Mail is hosted by Fastmail (the
domain's MX is `messagingengine.com`). Confirmed by the owner on 2026-10-26: bug-report emails are deleted after one year without
further exchange; Fastmail (Fastmail Pty Ltd, Australia) keeps them on servers in the US; the
Cloudflare account is on the Free plan, so Workers Logs keep 3 days and Analytics Engine 3 months.
Step 0 is left for later.

Found while implementing: Workers invocation logs kept request URLs, including the typeahead's
`?q=`, against privacy 第4条第4号. They are now off (`[observability.logs] invocation_logs = false`).
The `[usage]` lines and errors are still logged.

I'm not a lawyer. The legal-text steps fix places where the published terms or privacy policy
don't match what the service does, or say less than users need. They don't add new legal
positions. Steps marked **owner** need a decision before they're written.

## Summary

| # | Step | Kind | When |
|---|---|---|---|
| 0 | Spend protection outside the app (Google quota, gateway limit, key audit, alert, test) | Owner, console | Before anything else |
| 1 | Decide the monthly cap | Owner | Before the first post |
| 2 | Cap-reached experience: one calm message, free features keep working | Code | Before the first post |
| 3 | Bug-report link on the main screen | Code | Before the first post |
| 4 | Terms of service update | Legal text | Same release as 2 and 3 |
| 5 | Privacy policy update | Legal text | Same release as 2 and 3 |
| 6 | Phase 2 features: sample comparison, copy routine link, symptom tags | Code + legal text | Weeks 3–6 |
| 7 | Per-request cap for the 2027-01-01 Gemini price | Code | Before 2027-01-01 |
| 8 | New shops or affiliate networks | Legal text first, then code | Phase 3 |

Steps 2–5 ship together with one `LEGAL_VERSION` bump, so users are asked to agree again once.

## Step 0: spend protection outside the app (owner)

**Now.** `SpendCapObject` (`src/lib/server/spend-cap.ts`) limits only calls made through the
Worker. The Gemini key sits in the AI Gateway's Provider Keys. If `CF_AIG_TOKEN` or that key
leaks, nothing caps the spend, and Google's budget alerts arrive hours late.

**Do, in this order:**
1. **Google Cloud → APIs & Services → Generative Language API → Quotas:** lower "requests per
   minute" and "requests per day" to a little above the app's own limits
   (`SPEND_PER_MINUTE_GEMINI = 60`; per day, $10 ÷ the cheapest call in `src/lib/server/prices.ts`,
   rounded up). Write the numbers in this plan.
2. **Cloudflare → AI Gateway → `cosmetantei-prod` → Settings:** turn on rate limiting a little
   above the same per-minute limit. Keep caching off (provider terms, see
   [caching rules](gemini-role-redesign.md#storage-and-caching-by-provider-terms)).
3. **Key audit:** in the same Google Cloud project, list every API key. Any key besides the
   gateway's must not be allowed to call the Generative Language API (restrict it by API, or
   delete it). Check that the gateway key is restricted to that one API.
4. **Budget alert:** Google Cloud Billing → Budgets, at about $20 a month, alerts at 50 % and
   100 %. It only warns; the quota is the cap.
5. **Test:** set the Google quota to a tiny value for 10 minutes, run a web research on the live
   site, and check that (a) Google refuses, (b) the app shows the step 2 message, not an error,
   (c) the gateway log shows the refusals. Then restore the quota.

## Step 1: the monthly cap (owner)

`SPEND_BUDGET_USD = "10/100"`: 10 full days at $10 use the whole month. The phased plan raises the
day cap later, which then can't be reached at all.

Options:
- **Keep $100 a month** and accept that heavy days early in a month shorten the month. Then the
  cap-reached message (step 2) must not say 「本日」 when the month is what ran out.
- **Raise the month cap with each phase** (e.g. Phase 1 `10/150`, Phase 2 `15/300`).

Decided 2026-10-26: keep `10/100` for now. Recommended: keep `10/100` for Phase 1. It's the safer default while real cost per user is
unknown. Handle the month case in step 2.

## Step 2: what users see at the cap

**Now.** Not checked end to end. `gemini-client.ts:266` records `capped` and skips the call. What
each route then returns to the screen (chat search, web research, label photo, ingredient
explanation, shop prices) hasn't been compared.

**Check first.** With `SPEND_BUDGET_USD = "0/0"` in `.dev.vars`, run each feature and record what
the screen says. With `"0.01/100"`, check that the day case and the month case can be told apart
(the Durable Object knows which limit refused; make it say so if it doesn't).

**Change.**
1. One reply per case, from `src/lib/services/chat-replies.ts`, not an error:
   - day: 「本日の検索の上限に達しました。成分表示の貼り付けと、保存済みの商品での比較は引き続き使えます。」
   - month: 「今月の検索の上限に達しました。成分表示の貼り付けと、保存済みの商品での比較は引き続き使えます。」
   - per-visitor limits (per IP, session, network) keep their own wording, but not 「本日」 for
     everyone.
2. **Photo reading uses Gemini,** so at the cap the photo button says it's unavailable today and
   points to pasting the text. Don't promise 撮影 in the message.
3. Free paths keep working: label paste, saved/cached products, the rule-based analyzer.
4. Optional (Phase 2): under the message, list a few products that are already cached, picked
   from the KV cache, not hard-coded (cached facts expire after 7 days).

**Tests:** with the spend cap stubbed as exhausted (day, then month), each paid route returns its
message and makes no paid `fetch`; label paste and the analyzer still return results.

## Step 3: bug-report link on the main screen

**Now.** The contact address appears only on `/terms` and `/privacy`.

**Change.**
- A small 「不具合を報告」 link in the main screen's footer area (near the existing legal links in
  `ChatContainer.tsx`), opening
  `mailto:contactme@cosmetantei.app?subject=【不具合報告】コスメ探偵&body=…`.
- The body is a short template only: 「起きたこと：／その前にした操作：／端末とブラウザ：」, then
  「※肌の症状や病歴、氏名などの個人情報は書かないでください」.
- **Don't fill in** the user's lists, chat text or labels automatically. That would turn an email
  into a copy of health-related input.
- No form service: a third-party form would be a new recipient for the privacy policy and the
  外部送信 table. Email needs no new recipient.
- Add it to `/dev/gallery` (test 114) and run `pnpm check:responsive` (44px target).

## Step 4: terms of service (`src/app/terms/page.tsx`)

Each change says what the service does now, so users know what to expect.

| # | Where | Now | Change |
|---|---|---|---|
| T1 | 第5条第2項 | 「基本機能は無料…将来的に有償機能または制限を導入する場合は…告知」 | Limits already exist. Rename 第5条 to （アカウント登録・利用料金・利用上限）. Say: free as a β版; a daily and monthly upper limit on searches and AI features for the whole service, and per visitor; when it's reached, web research, AI explanations and photo reading stop until it resets, while label paste and saved products keep working; limits may change without notice. Keep the advance notice for paid features. |
| T2 | new 第5条の2（β版） | — | The service is in β: features and display may change, and bugs may happen. Reports are welcome (link to the contact section). **No disclaimer wording**: test 109 forbids 免責・責任を負いません, and 第9条・第9条の2 already cover it. |
| T3 | new 第5条の3（ご意見・不具合報告） | — | Reports may be used to improve the service. Individual replies aren't guaranteed. Don't include symptoms, medical history or other personal details. A report is never published, even partly, without the sender's consent. |
| T4 | 第6条第2項 | Routine PNG and QR code | Add the share link (`#r=…`) and, from step 6, the copy-link button. Same free use. Labels the user typed or photographed aren't included. |
| T5 | 第8条第1項第4号 | Spend cap → service may stop | Keep, and point to 第5条 for what still works. |
| T6 | 第12条第2項 | 「本サイト上への掲示その他適切な方法」 | Also say that, after a change, the confirmation screen asks users to agree again (what `CONSENT_VERSION` already does). |
| T7 | お問い合わせ窓口 | Address only | Add 「不具合のご報告・ご意見も、こちらで受け付けています」 and the reply note from privacy 第11条. |

## Step 5: privacy policy (`src/app/privacy/page.tsx`)

| # | Where | Now | Change |
|---|---|---|---|
| P1 | 第1条第1号, 第2条, 第9条第1項 | Says no email addresses are collected or held | **Not true once people email bug reports.** Add a 第2条 item 「お問い合わせ・不具合報告で受け取る情報」: email address, any name given, message, attachments (screenshots), date. State how long they're kept (**owner**: e.g. one year after the reply) and the mail provider (**owner**: name and country; if outside Japan, add to 第6条). Reword 第1条第1号 to 「登録は求めません」 (still true) and 第9条第1項 so that 開示・訂正・削除 requests are handled for these emails. |
| P2 | 第2条第3号 | Chat questions listed, no warning | Add: please don't enter symptoms, medical history or pregnancy. If entered, the text is checked by Workers AI (Cloudflare, already in 第5条) to decide the reply, answered with a fixed message suggesting a dermatologist, and not stored or sent on. Check the last part against `chat-gate.ts` before writing it. |
| P3 | 第2条第1号 | Access logs listed, no retention | Add retention: Cloudflare's request logs (check `wrangler.toml` `[observability]` and the dashboard setting), Analytics Engine (Cloudflare keeps 3 months; confirm), and the spend and rate-limit counters (check `spend-cap.ts` for how long per-IP and per-session counts are kept). Only write periods confirmed in config or code. |
| P4 | 第2条第5号 | Routine image made in the browser | Add the share link: the part after `#` holds product IDs, brands and names, and browsers don't send it to the server; anyone who gets the link can see that list; typed or photographed labels aren't included. **Check** what happens after a link is opened (`decodeShareFragment` restores names only, `namesOnly`): if the app then searches those names, say that the names are sent to the server and to Open Beauty Facts, as for a typed search. |
| P5 | 第10条 | Changes take effect when posted | For changes that add a purpose of use or a new recipient: announce them in advance and ask for agreement again on the confirmation screen. Small corrections still take effect when posted. |
| P6 | 第11条 | Contact | Add 不具合報告 as a purpose, as in T7. |

**After both steps 4 and 5:**
- Bump `LEGAL_VERSION` in `src/lib/site.ts` and add a line to its comment listing the changed
  clauses.
- Test 109: assert that the terms mention β版 and the upper limit; the privacy policy has the
  contact-email item and its retention; 「メールアドレス等を含む個人情報を収集・保持しておりません」
  is gone; and the β wording adds no 免責.
- Update `docs/legal/privacy-policy.md` and `terms-of-service.md` (local drafts) to match.

## Step 6: Phase 2 features (weeks 3–6)

Each one comes with its own legal-text check, and ships with a `LEGAL_VERSION` bump if it adds
anything to the policy.

1. **「サンプルで比較を試す」**: loads 2 irritating + 2 safe products and runs the analyzer.
   Products come from OBF or `cosmetics-db` (long-lived), not from 7-day web facts, so the sample
   doesn't expire or start paid research. The wording keeps to the no-diagnosis copy. No policy
   change.
2. **Copy routine link**: a button in `RoutineExportDialog.tsx` that copies `encodeShareLink(…)`.
   Fragment only, never query parameters. Covered by T4 and P4.
3. **Symptom tags** (ピリピリ・赤み / 乾燥・つっぱり / 毛穴・ポツポツ) on irritating products, giving
   one comparison per tag. Kept in page memory like the lists: not in `localStorage`, the share
   link, the PNG, analytics or any request. Add one sentence to 第2条第4号 when it ships. Tests:
   no request body or analytics record contains a tag.

## Step 7: per-request cap before 2027-01-01

`SPEND_PER_REQUEST_USD = 0.3` stops covering one web research when the Gemini price doubles
(`src/lib/server/prices.ts` already has the new price). Compute the cap from the price table
(one research = search + 3 page reads, plus a margin), with a test that fails if a full research
no longer fits. Then re-size the day and month budgets from the cost per user measured in Phase 1.

## Step 8: new shops or affiliate networks (Phase 3)

Before any Qoo10 or もしもアフィリエイト link goes live, update all of these in one change:
- terms 第2条第4号, 第8条第1項第3号, 第10条第1項, 第11条第1項;
- `AFFILIATE_DISCLOSURE` (`src/lib/site.ts`);
- privacy 第5条 and the 外部送信 table (第7条2.);
- `docs/legal/connected-services.md`;
- test 109's check that the disclosed networks match `wrangler.toml`.

## Order and release

1. Step 0, then step 1 (owner, no code).
2. Step 2 → step 3 → steps 4 and 5 in one branch. Then `pnpm test`, `typecheck`, `lint`,
   `check:responsive`, `pnpm preview`, and deploy.
3. Seed the cache 1–2 days before the first post (to-do list, section 2).
4. Step 6 during Phase 2; step 7 in December; step 8 in Phase 3.

## Owner decisions needed

- Monthly cap (step 1).
- How long bug-report emails are kept, and which mail provider (P1).
- Whether to name official SNS accounts in the terms (T6). Not needed; the confirmation screen is
  the main notice.
- A lawyer's look at the reworded clauses before launch, together with 第9条の2, which
  `pre-publish-audit-fixes.md` already flags.

## Not changing

- **Longer caching, and public SEO pages built from cached lists.** Both conflict with the
  provider terms and with privacy 第2条第6号 (see the to-do list's "Not doing").
- **A form service for bug reports.** It would add a recipient; email does the job.
