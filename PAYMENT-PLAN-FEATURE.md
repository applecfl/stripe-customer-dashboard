# Feature: Payment Plan (Installments) on Pay Links

Let the office offer a customer a **payment plan** on a Payment Request. The office sets a
*max number of installments* + an *end date*. The customer, on `/pay`, chooses how many
installments they want (1..max) — always **monthly**, never past the end date. They pay
installment #1 now (card saved); the remaining N−1 are created as scheduled invoices that
Stripe charges automatically each month.

---

## Locked decisions

| Topic | Decision |
|---|---|
| Cadence | **Monthly**, fixed. Installment #1 = today, then same day-of-month each month. |
| Max installments | **Derived from the end date** — how many whole months fit between today and `endDate`. The office's "max" input is capped by this. |
| Who chooses the count | **Customer**, on `/pay` (any value 1..max). 1 = pay in full today. |
| Never past end date | The last installment's date ≤ `endDate`, always. |
| Even split remainder | Extra cents go to the **first** installment (charged today) so the customer is never surprised by a bigger last charge. |
| First payment | **Charged today** via the existing pay-link flow (3DS + card-save), guaranteeing a working, saved card. |
| Future installments | Created by the **existing engine** — `POST webhook.lec.li/stripe/createFutureInvoices` (Stripe finalizes & charges automatically; no cron). |

## We reuse the existing engine — we do NOT build a scheduler

The dashboard already proxies to the production installment engine:
[create/route.ts](src/app/api/stripe/invoices/create/route.ts) →
`${EXTERNAL_API_URL}/stripe/createFutureInvoices` (`EXTERNAL_API_URL=https://webhook.lec.li`).
That engine (`lecapp-webhooks` → `createInvoiceWithItems`) already does monthly cadence,
per-date amounts, `lastPaymentAmount`, `default_payment_method`, `automatically_finalizes_at`,
and America/New_York dates. See memory `lecapp-webhooks-payment-engine`.

**Why the first payment does NOT go through that engine:** its immediate-charge path
(`createPaymentIntent`) uses `allow_redirects:'never'` and never saves the card — no 3DS, no
`setup_future_usage`. Our `/pay` (pay-link) already handles 3DS + card-save. So:
**installment #1 → pay-link (existing); installments #2..N → createFutureInvoices.**

---

## The office side — creating the request

### What the office enters (in TuitionStatementModal, payment mode)

A new **"Offer a payment plan"** toggle. When ON, two inputs only:

| Field | Type | Rules |
|---|---|---|
| **Max installments** | number | 2–12. This is a ceiling the customer can choose *up to*. |
| **Final payment by** | date (flatpickr) | Must be a future month. Determines the real max (whole months from today). |

Everything else is **derived** — the office does NOT enter amounts or intermediate dates:
- Total = the Payment Request amount (outstanding by default; already in the modal).
- Effective max = `min(maxInstallments, wholeMonthsBetween(today, endDate) + 1)`.
- The split and the monthly dates are computed by the system.

**Why so few fields:** the office already has enough cognitive load. They set the outer
bounds ("up to 6 payments, done by December"); the math and the customer's actual choice are
handled downstream. Fewer fields = fewer mistakes.

### What the office sees (live preview in the modal)

Under the toggle, a read-only summary that updates as they type:

```
Plan offer: up to 4 monthly payments, finishing by Dec 1, 2026.
The customer can choose 1–4 payments. Example at 4:
  $250.00 today, then $250.00 on Oct 1, Nov 1, Dec 1.
```

- If the end date allows fewer than the entered max, show a gentle note:
  *"Only 3 whole months fit before Dec 1 — customer can choose up to 3."*
- If a per-installment amount would fall below Stripe's ~$0.50 minimum, block with:
  *"Amount too small to split this many ways."*

### What gets signed into the link

`generatePaymentLinkToken(...)` gains a `plan`:
```ts
plan: { maxInstallments: number; endDate: number }   // endDate = unix seconds
```
Signed → tamper-proof. `amount` stays the full total. No amounts/dates are signed — they are
derived deterministically from (total, endDate, chosen count, and the charge day), so the
server always recomputes them and the client can never dictate them.

### The email

Unchanged pay button. One added line when a plan is offered:
*"You can pay in full, or split into up to N monthly payments."*
The actual chooser lives on `/pay`, not in the email.

---

## The customer side — `/pay`

### What the customer sees

When the token carries `plan`, above the card entry show a **plan chooser**:

```
How would you like to pay?
  ○ Pay in full — $1,000.00
  ● Split into monthly payments
       [ 2 ]  3   4        ← segmented control, 2..max
       $500.00 today, then $500.00 on Oct 1.
```

- Default: **Pay in full** (safe, no surprise).
- Choosing "Split" reveals a segmented selector 2..max. Selecting a number shows the live
  breakdown: first amount + subsequent dates/amounts. All monthly, last ≤ endDate.
- Pay button label reflects the choice: **"Pay $1,000.00"** vs **"Pay $500.00 now"**, with a
  sub-line *"then 1 more payment of $500.00 on Oct 1"*.
- Card entry / saved-card selection unchanged. When a plan is chosen the card is **saved by
  necessity** (needed to charge the future installments) — surface that:
  *"Your card will be securely saved to complete the remaining payments."*

### Success screen (plan chosen)

```
Payment Successful
$500.00 received. Your remaining 1 payment of $500.00 is scheduled for
Oct 1, 2026 on your card ending 4242.
```

---

## The plumbing

### 1. Installment math — `src/lib/installments.ts` (new, pure)

```ts
export interface Installment { index: number; amount: number; date: number } // cents, unix s

// whole calendar months (same day-of-month) from `nowSec` up to and incl. endDate.
export function maxMonthlyInstallments(nowSec: number, endDateSec: number): number;

// Build `count` monthly installments starting today. Even split; remainder on #0.
// Guarantees installments[count-1].date <= endDateSec.
export function buildPlan(
  totalCents: number, count: number, nowSec: number, endDateSec: number
): Installment[];
```

Rules: `count>=1`; `count` clamped to `maxMonthlyInstallments`; each amount `>= 50`
(else caller rejects); date #i = today + i months (NY tz), clamped so #last ≤ endDate.
Used by the modal preview, `/pay` preview, and the charge route — one source of truth.

> Cadence math must match the webhook engine's monthly step (luxon `.plus({months:i})`,
> America/New_York). We compute the explicit `Dates` array and send it, so the two agree
> exactly rather than relying on both deriving the same dates independently.

### 2. Token — `src/lib/auth.ts`
`PaymentPlanConfig { maxInstallments; endDate }`; `plan?` on `TokenPayload`;
`generatePaymentLinkToken(..., plan?)` writes it.

### 3. Send route — `send-tuition-statement/route.ts`
Accept + validate `plan` (2..12, future endDate, per-installment ≥ $0.50 at max). Pass to
`generatePaymentLinkToken`.

### 4. `/pay` page + PayLinkForm
Page passes `payload.plan` (+ server-computed `now`) to the form. Form renders the chooser
using `buildPlan`. On submit it sends `chosenCount` (only meaningful when >1).

### 5. Charge route — `pay-link/route.ts` (the core change)
When `payload.plan` present and `chosenCount > 1`:
1. Recompute `plan = buildPlan(total, chosenCount, now, endDate)` **server-side** (ignore any
   client amounts). `chargeNow = plan[0].amount`.
2. Force card-save semantics: attach the PM + `setup_future_usage:'off_session'` so future
   charges work off-session. (New card path already does this when `saveCard`; force it on.)
3. Create+confirm PaymentIntent for `chargeNow` (existing path, incl. 3DS). Metadata:
   `plan:'true'`, `planCount:chosenCount`, `planGroup:sig`.
4. **After success** (and after 3DS in `finalize`), guarded by a Firestore
   `planScheduled` flag on the link record (idempotent):
   - Resolve the card used (`paymentIntent.payment_method`).
   - Build the future `Dates` = `plan[1..].date` (ISO, NY) and `Amount` = `plan[1..].amount`
     (array).
   - `POST ${EXTERNAL_API_URL}/stripe/createFutureInvoices` with one invoice:
     `{ CustomerID, Amount:[amounts], Frequency:'Dates', Dates:[dates],
        PaymentMethodId:<card>, FirstPaymentNumber:2, Currency:'usd',
        Description, Metadata:{ InvoiceUID, planGroup:sig } }`.
     (`Amount` as an array = per-date amounts — the engine supports this in customDates mode.)
   - Persist `planScheduled:true`, `scheduledCount`, and returned invoice ids on the record.
5. Set the link counter `remaining = 0` (plan chosen ⇒ link fulfilled; the rest lives in the
   scheduled invoices, so the link can't be reused to over-collect).

### 6. finalize route — `pay-link/finalize/route.ts`
Runs the same post-success block (step 4–5) for the 3DS path. Extract into a shared
`schedulePlanRemainder(sig, payload, paymentIntent)` used by both routes.

### 7. Firestore record — `paymentLinks.ts`
Add `planScheduled?: boolean`, `scheduledInvoiceIds?: string[]`, `planCount?: number`.
`planScheduled` inside a transaction is the dup-guard.

---

## Directive & safety

- **Sholem's rule holds:** the future installments are NEW invoices we create for THIS
  InvoiceUID (specific context) — we never void/delete the customer's other unrelated
  invoices. Only the plan's own invoices are involved.
- **Idempotency:** `planScheduled` flag (txn) + PI idempotency key ⇒ retries/3DS re-entry
  never double-charge or double-schedule.
- **A later monthly charge fails:** it's a normal failed/open invoice in the dashboard;
  staff already have Retry / Reschedule. No new machinery.
- **Customer picks "pay in full":** plan ignored; existing full-charge path; counter as today.
- **Partial pay disabled for plan links** — plan is all-or-nothing on #1. (Dynamic partial
  pay stays only for non-plan links.)
- **Webhook down when scheduling:** #1 already charged. Record `planScheduled:false` + the
  intended dates/amounts; show the customer success for #1 but log the scheduling failure and
  surface it to staff (a scheduled retry of just the createFutureInvoices call). Do NOT fail
  the whole payment after money was taken.

---

## Files touched

| File | Change |
|---|---|
| `src/lib/installments.ts` | **new** — `maxMonthlyInstallments`, `buildPlan` |
| `src/lib/auth.ts` | `PaymentPlanConfig`; `plan` on payload; token generator arg |
| `src/lib/paymentLinks.ts` | `planScheduled`, `scheduledInvoiceIds`, `planCount` + setter |
| `src/lib/plan.ts` | **new** — `schedulePlanRemainder()` (calls createFutureInvoices), shared |
| `src/components/dashboard/TuitionStatementModal.tsx` | plan toggle + 2 inputs + live preview; send `plan` |
| `src/app/api/stripe/send-tuition-statement/route.ts` | accept/validate `plan`; mint token with it |
| `src/app/pay/page.tsx` | pass `plan` + `now` to form |
| `src/components/pay/PayLinkForm.tsx` | plan chooser (full vs 2..max) + previews |
| `src/app/api/stripe/pay-link/route.ts` | charge #1, then schedule remainder |
| `src/app/api/stripe/pay-link/finalize/route.ts` | schedule remainder after 3DS |

## Build order

1. `installments.ts` — pure, verify the month math + remainder by hand.
2. Token `plan` + send route + modal UI & preview (office can create plan links).
3. `/pay` chooser (read-only display of the plan; no charge changes yet).
4. `plan.ts` `schedulePlanRemainder` + wire into pay-link + finalize. **Critical step.**
5. End-to-end on a test-mode customer: choose 3 payments → confirm #1 charged, card saved,
   2 future invoices exist with right dates/amounts/default_payment_method; let one finalize.
