# Fixing the compliance audit findings

Written 2026-10-21. Status: steps 1–7 done 2026-10-22 (not committed). Step 6 still needs a lawyer to read 第9条の2 before it is deployed.

The audit is `docs/legal/compliance-audit-report.md` (Gemini, 2026-10-21, against commit `16a4118`).
`docs/legal/` is gitignored, so this plan restates each finding briefly. Every finding was checked
against the current code (`fe4bdae`). Line numbers below are from that commit.

I'm not a lawyer. Steps 1–5 and 7 make the wording safer or stop a claim that can't be checked, so
they can go ahead. Step 6 (the liability clause in the terms) is a legal decision for the owner,
ideally with a lawyer. The audit's draft clause has problems of its own (see step 6).

## Summary

| # | Audit finding | Verified? | Plan |
|---|---|---|---|
| 1 | 「鎮静」「バリア修復」 on screen | Yes, plus 2 more the audit missed | Step 1 |
| 2 | 「有効成分」 shown for ordinary cosmetics | Partly: the normal pipeline marks these products as 医薬部外品, but nothing enforces it | Step 2 |
| 3 | The terms have no liability clause | Yes, by design (`f2d16e3`) | Step 6 (owner decision) |
| 4 | 「最も安いのは」 in the price reply | Yes | Step 4 |
| 5 | 「肌に浸透させるには」 in the ingredient DB | Yes | Step 1 |
| 6 | Skin-care instructions while skin is red or stinging | Yes | Step 5 |
| 7 | The privacy policy says Gemini is on a paid plan | Can't check from the code | Step 7 (owner check) |
| – | AI-written ingredient text has no wording check | Found while checking 1 and 5 | Step 3 |

## Step 1: efficacy wording (findings 1 and 5, plus two the audit missed)

Under the 適正広告基準, a cosmetic's claims must stay within the 56 efficacy items: 肌を整える,
肌をすこやかに保つ, 肌にうるおいを与える, 肌を保護する and so on. 「鎮静」, 「修復」 and 「補修」
suggest medicinal action. Penetration claims must be limited to the 角層.

| Where | Now | Change to |
|---|---|---|
| `src/components/chat/IngredientAnalysisCard.tsx:429` (heading of the green box) | 鎮静・バリア修復サポート成分 | 肌を整える・うるおいを保つ成分 |
| `src/lib/services/chat-replies.ts:73` | `soothing: '鎮静成分'` | `'肌を整える成分'` |
| `src/lib/services/chat-replies.ts:74` (**missed by the audit**) | `barrier_support: 'バリア補修成分'` | `'うるおいを保つ成分'` |
| `src/lib/services/chat-replies.ts:176` | `鎮静・バリア成分: …` | `肌を整える・保湿成分: …` |
| `src/lib/data/ingredients-db.ts:471` (glycolic acid) | 肌に浸透させるには… | 角層まで届かせるには… |
| `src/lib/data/ingredients-db.ts:696` (ツボクサ, **missed by the audit**) | …炎症を抑え傷の治りを助ける働きが報告されています。 | Rewrite to describe what the ingredient is, not what it treats, e.g. 「ツボクサ由来の成分で、マデカッソシド等のトリテルペンを含みます。化粧品では肌を整える目的で配合されます。」 |

- **Internal names stay.** The category keys `soothing` and `barrier_support` are never shown. Renaming
  them would touch the AI schema, cached AI results and shared routine images for no legal gain.
  Only the code comments that describe them change (`src/lib/types/index.ts:28-29`, `ingredients-db.ts:639`,
  `IngredientAnalysisCard.tsx:298`, `ingredient-analyzer.ts:326`), so the next person doesn't copy the old words.
- **Sweep the rest of the DB.** Read every `reasonJa` and `sensitiveSkinAdviceJa` in the
  `soothing` / `barrier_support` entries for 「炎症」「傷」「治り」「抑える」「和らげる」. A grep for the obvious
  words found only ツボクサ, but phrasing varies.

**Done (step 1).** All the replacements above, plus three more found in the DB sweep:
- セラミド: 「肌のバリアを支えます」 → 「角層のうるおいを保ちます」.
- ナイアシンアミド: 「肌のバリア機能を支える成分」 → 「肌を整える成分」.
- グリセリン: 「バリアの回復を助ける」 → 「肌にうるおいを与えます」.

Test 108 now also bans 鎮静, 修復, 補修, 炎症を抑え, バリアの回復, 肌に浸透 and 皮膚に浸透.
Step 3 moves that list into a shared module.

## Step 2: 「有効成分」 only for 医薬部外品 (finding 2)

**What the code does now.** The audit's main scenario doesn't happen in the normal pipeline:
- The label parser sets `isQuasiDrug` whenever it finds a 有効成分 heading or mark (`label-parser.ts:231-246`).
- Web research sets it whenever there are actives (`web-research.ts:401`, `:741`).

**Where it can still go wrong:**
- Nothing enforces "actives ⇒ 医薬部外品".
- A shared routine image or `#r=` link can carry `activeIngredientsJa` without `isQuasiDrug` (`routine-share.ts:89-91`).
- `web-research.ts:401` adds actives only when `plausible`. Check whether actives can survive when it isn't.
- The analysis card labels single ingredients 「有効成分」 (`IngredientAnalysisCard.tsx:490`, `:543`) from
  `labelIngredients`, which marks every item in `activeIngredientsJa` as active without checking the
  product. The audit missed this.

**Changes:**
1. **One rule at the data boundary.** In `validateProduct` / the routine import, if `activeIngredientsJa`
   is present and `isQuasiDrug` isn't true, move the actives to the front of `ingredients` and drop the
   field. The product then reads as an ordinary cosmetic with a full ingredient list, which is what it
   legally is. Moving them keeps the analysis complete; dropping them would hide ingredients.
2. **`labelIngredients`** marks `isActive` only when `product.isQuasiDrug`. This covers the analysis card.
3. **Display guard** in `ProductSuggestionCard.tsx:138` and `LiveSearchCandidateTray.tsx:242`: show the
   actives line only when `isQuasiDrug`. This is belt and braces after change 1. Keep the label 「有効成分:」;
   the card already shows a 医薬部外品 badge next to the name, so 「有効成分（医薬部外品）」 repeats it.
4. **English OTC labels.** Check whether the label parser treats "Active Ingredients" (US Drug Facts)
   as a 有効成分 heading. A US OTC sunscreen is not a Japanese 医薬部外品. If the parser does, those
   actives go into `ingredients`, with no 医薬部外品 badge.

**Test (new, 115):**
- A product with actives but no `isQuasiDrug`, passed through validation, the routine import and
  `labelIngredients`, ends up with no active ingredients and nothing lost from the list.
- The two cards render no 「有効成分」 for it.

**Done (step 2), with one change from the plan.** The rule is applied where 「有効成分」 is shown and where
the analysis labels ingredients, not where data comes in:
- `src/lib/quasi-drug.ts`: `quasiDrugActives(product)` returns the actives only when `isQuasiDrug === true`.
  Both cards use it.
- `labelIngredients` marks an ingredient as active only for 医薬部外品. For any other product, the actives
  are analysed as ordinary ingredients and added after the label's own list, which keeps the cosmetic's
  order (most to least).
- **Why not move the actives into `ingredients` when data comes in, as the plan said:** the merged list
  could go over the ingredient limit, and the server would then reject the saved product. Guarding the two
  places that read the list loses nothing, and covers shared links, saved lists and API payloads alike.
- **Checks from the plan:**
  - The label parser recognises only Japanese 有効成分 headings, so US "Active Ingredients" never become
    actives. No change was needed.
  - `web-research.ts:401` keeps actives only when the label is plausible, and then marks the product as
    医薬部外品. No change was needed.
  - Analysis results are never stored (only reply text is cached), so the analysis card's `isActive` is
    always recalculated.
- Test 115.

## Step 3: the same wording rules for AI-written text (not in the audit)

The audit only checked fixed text. Gemini writes `reasonJa`, `sensitiveSkinAdviceJa` and `evidenceJa`
for ingredients the DB doesn't know (`dynamic-ingredient-service.ts`), and those are shown in the same
green box. Nothing stops the AI from writing 「鎮静」「肌の奥まで浸透」「修復」.

1. **One shared list.** Move the banned-wording regex from Test 108 into `src/lib/wording.ts`, as
   `PROHIBITED_CLAIMS`, with a comment giving the legal reason for each group. Test 108 then imports it,
   so the test and the app can't drift apart.
2. **Add the audit's words to the list:** 鎮静, 修復, 補修, 肌に浸透, 皮膚に浸透, 抗炎症, 炎症を抑え,
   最も安い. Keep the existing exception for the retired quick-reply label.
3. **The AI prompt** (`ITEM_RULES`, `dynamic-ingredient-service.ts:884`) gets one more rule: describe
   effects only in the words of the 56 cosmetic efficacy items; no 鎮静・修復・抗炎症; penetration only
   「角層まで」.
4. **Check the reply** where the item is validated (around `dynamic-ingredient-service.ts:1036`): if
   any text field matches `PROHIBITED_CLAIMS`, return `null`. That's the existing "unusable reply" path:
   the ingredient shows as unevaluated rather than with a bad sentence. Don't cache the rejected reply.
5. The chat replies already have `hasAssurance` (`chat-replies.ts:26`) for 治ります and the like. Check
   them against `PROHIBITED_CLAIMS` too, using the same fallback.
6. **Cached AI results.** KV holds AI ingredient text for up to 30 days. Either bump the cache key
   version so old text is regenerated, or apply the check when reading from the cache as well.
   Checking on read is cheaper and also covers anything cached before this change.

**Tests:**
- Test 108 uses the shared list.
- A new unit test feeds the validator a reply containing 「鎮静」 and expects `null`, and expects an
  ordinary reply to pass.

**Done (step 3), with one change from the plan:**
- **`src/lib/wording.ts`** holds the banned-wording list, the guarantee check that was in `chat-replies.ts`
  (`hasAssurance`), and the prompt rule.
  - Test 108 uses the same list. It skips this one file, because the file names the words.
- **Prompts:** both the ingredient prompt and the chat prompt include the rule.
- **Chat replies:** a reply containing banned wording falls back to the fixed reply, as before.
- **AI ingredient text (the change from the plan):** only the sentence containing banned wording is
  replaced with a fixed sentence. The risk rating is kept.
  - **Why:** the code review found that rejecting the whole reply also threw away an irritant rating.
  - If the evidence sentence is the one replaced, a 「安全」 rating becomes 「未評価」.
  - Text cached before this change is checked when it's read.
- **Test 116.**

## Step 4: 「最も安い」 (finding 4)

`src/lib/services/price-service.ts:257`: 「最も安いのは…」 → 「今回確認できた中では、…が最も安く…円…です」.
The sentence before it already gives the count and time, so the scope is clear from the wording.

- Also check `PriceResultCard.tsx` for any 「最安」 badge or heading. The grep found none, but check the
  rendered card in `/dev/gallery?screen=price`.
- Test: update the existing price-summary assertion, if there is one, to the new sentence.

Done 2026-10-22: the summary reads 「今回確認できた中では、…が最も安く、…円です。」. No 「最安」 badge or heading exists. Test at the price-summary assertion.

## Step 5: advice while the skin is red (finding 6)

`src/lib/analyzer/ingredient-analyzer.ts:656`. Today the app tells someone with red, stinging skin to use
only ワセリン or セラミド until it settles. That is a care instruction for a possible skin condition.
Replace it with:

> 赤みやヒリつきなどがあるときは使用を中止し、皮膚科専門医にご相談ください。

- Drop the audit's 「自己判断でのスキンケアの継続は避け、医師の指示に従ってください」. Telling people
  to follow their doctor is what 第3条3 of the terms already says, and the shorter sentence matches its
  wording.
- Search the other advice strings (`adviceJa` in the analyzer, the chat reply prompts) for any other
  care steps: 「保湿だけに」「休ませ」「塗って」.
- Test: Test 108 gains 肌を休ませ.

Done 2026-10-22: the ワセリン advice is replaced with the sentence above; no other care steps were found. 肌を休ませ is in `src/lib/wording.ts`. Test 117.

## Step 6: liability clause in the terms (finding 3): owner decision

**Background.** `f2d16e3` deliberately left out liability clauses, because 消費者契約法 第8条 voids
clauses that exempt a business from liability. The audit says that is wrong, and that with no clause the
default rules of 民法 415 and 709 apply without any cap. That part is right: having no clause means no
limit.

**The audit's draft clause shouldn't be used as written:**
- **Its paragraph 1** (「故意または重過失がある場合を除き、一切の責任を負いません」) exempts the business
  from *all* liability for slight negligence. 第8条第1項第1号 voids a full exemption whatever the degree
  of fault.
- **Its paragraph 2** caps liability at ¥1,000 even for gross negligence, which 第8条第1項第2号 voids.
  Its opening, 「法令の適用により…無効と判断される場合であっても」, is the kind of catch-all wording
  that 第8条第3項 (in force since 2023-06-01) makes void when the clause doesn't say it applies only to
  slight negligence.
- **Physical harm.** The risk the audit worries about is a skin reaction, which is harm to the body. A
  small fixed cap on that kind of harm is at risk under 第10条 even if it is limited to slight negligence.

**Options:**

A. **Add a narrow clause** (recommended, after a lawyer reads it). For example, as 第9条の2 so the
   other articles keep their numbers:

   > 第9条の2（損害賠償の制限）
   > 1. 当方の故意または重大な過失による場合を除き、本サービスに関して当方がユーザーに対して負う損害賠償責任は、当方の軽過失による場合に限り、ユーザーに現実に生じた通常かつ直接の損害の範囲に限られるものとします。
   > 2. 前項は、人の生命または身体に生じた損害については適用しません。

   Be clear about what this buys: because of paragraph 2, it limits claims for other kinds of loss,
   such as money spent on products, but not claims for a skin reaction. For a skin reaction, the
   protection comes from the disclaimers and from not giving care instructions (step 5), not from
   the clause. This leaves out the ¥1,000 cap. A fixed cap is where the risk of being voided is highest. If the
   owner wants a cap, a lawyer should set the amount and confirm it covers only slight negligence and
   only harm other than physical injury.

B. **Leave the terms as they are.** Write down why in this file. The main protections stay as they are
   now: 第3条, 第4条, 第9条, and the medical disclaimers on screen.

**If A:**
- Change `src/app/terms/page.tsx` and the draft `docs/legal/terms-of-service.md`.
- Set `LEGAL_VERSION` (`src/lib/site.ts:18`) to the release date. Every user then sees the consent
  dialog again, because the consent is stored per version (Test 111). A change that is worse for users
  shouldn't take effect without them agreeing again (民法 第548条の4).
- Test 109: assert the clause exists and doesn't contain 「一切の責任を負いません」.
- Commit message: say plainly that this replaces the "no liability clauses" decision in `f2d16e3`.

Done 2026-10-22: the owner chose A. `src/app/terms/page.tsx` has 第9条の2 as drafted above. The same revision also adds 第3条第5項 (AI text is checked before display), rewords 第4条第1項 (efficacy within the cosmetic range; 「有効成分」 only for 医薬部外品), and adds the price scope to 第9条. `LEGAL_VERSION` is 2026-10-22, and the new `LEGAL_ENACTED` keeps the 制定日; the terms page shows 最終改定日. Test 109.

## Step 7: Gemini paid plan (finding 7): owner check

`src/app/privacy/page.tsx:171` says the Gemini API is on a paid plan and the data isn't used for
training. That is true only if the production key's Google Cloud project has billing turned on. A
free-tier key's data may be used to improve Google's products. The code can't tell which kind of key
it has.

1. **Owner:** in Google AI Studio, open the API keys page and check that the project behind the
   production `GEMINI_API_KEY` shows a paid tier, not "Free".
2. **README, under "Deployment":** add a line saying that `GEMINI_API_KEY` must belong to a project with
   billing turned on, because the privacy policy says so. Also add this check to the steps for
   replacing the key.
3. **Until it's checked,** the safe wording is 「Google の規約に基づき取り扱われます」, without the claim
   about training. Change the sentence only if the check can't be done before the next deploy.
4. Check the same sentence for Workers AI (Cloudflare) if the privacy policy makes a similar claim.

Done 2026-10-22: the owner confirmed the production `GEMINI_API_KEY` is on the paid plan, so the privacy policy sentence stays as written.

The Gemini prompts were checked on the same day: the shared rules in `src/lib/wording.ts` now also cover 「有効成分」, claims beyond the cosmetic range (シミを消す・ニキビを治す・シワを改善・若返り), and care steps. The ingredient prompt no longer asks for advice while the skin is irritated. The chat prompt no longer asks why an ingredient is 「肌にやさしい」. The page-reading, label-reading, price and translation prompts only copy text and need no change.

## Order and release

1. Steps 1, 3, 4 and 5 in one change: wording plus the shared list and AI guard. Run the tests and
   `pnpm check:responsive`; the new heading is longer.
2. Step 2 on its own, because it changes data handling. Test it with a crafted `#r=` link.
3. Step 7, check 1: the owner can do it at any time.
4. Step 6, after the owner decides. It's a separate commit because it makes every user agree again.

Run `code-improver` after steps 1–5. Deploy after the tests and the responsive check pass. Steps 1–5 and
7 don't change the terms date, so nobody has to agree again.

## Not changing

- **The `soothing` / `barrier_support` keys:** they're never shown; see step 1.
- **The audit's 「すこやかに整える成分（セラミド・保湿等）」:** naming two examples in the heading would be
  wrong for products that contain other ingredients in the group. 「肌を整える・うるおいを保つ成分」
  stays within the efficacy list without them.
