# Opening LEC apps via GAM (for Magic)

The same GAM mechanism opens **two** apps:

| App | `aud` | App URL | `email` |
|---|---|---|---|
| Stripe Customer Dashboard | `stripe-dashboard` | `https://stripe.lec.li` | optional |
| Cal App (scheduler) | `cal-app` | `https://<cal-app-url>` *(fill in)* | **required** |

For either one you do **two steps**:

1. Ask the GAM issuer for a short **`code`** (one server-to-server call).
2. Send the user to the app with that code in the URL: `{APP_URL}/?code=<code>`.

That's it — **one POST, then one redirect.** Only the `aud`, the target URL, and the `data`
fields differ per app.

---

## Step 1 — get a code from GAM

`POST {GAM_BASE_URL}/auth/issue`

- **Prod `GAM_BASE_URL`:** `https://gam-service-364894474586.us-central1.run.app`
- **Auth:** IP allowlist — this call must come from one of the allowlisted Magic servers
  (see §"IP allowlist"). No bearer token needed.

**Request body (JSON):**
```json
{
  "AUD": "<stripe-dashboard | cal-app>",
  "Email": "user@lecfl.com",
  "Data": { ...per-app, see below... }
}
```
- `AUD` — **must be exactly** the app's audience (`stripe-dashboard` or `cal-app`). This is
  what tells GAM which app the code is for; each app rejects any other audience.
- `Email` — the `@lecfl.com` user. **Optional for `stripe-dashboard`, required for `cal-app`**
  (the cal backend rejects tokens whose `Email` is missing or not `@lecfl.com`).
- `Data` — the business context the app renders from, carried verbatim into the session. See
  the per-app sections below.

**Success response:**
```json
{ "success": true, "code": "<short-lived code>" }
```
- The `code` is valid for **~2 minutes**. Open the app URL promptly; don't cache it.

**Failure:** `{ "success": false, "error": "..." }` (or non-2xx). Surface the error and mint a
fresh code rather than reusing an old one.

---

## Step 2 — send the user into the app

Redirect the user's browser (or hand them a link) to:

```
{APP_URL}/?code=<code>
```
- Stripe dashboard → `https://stripe.lec.li/?code=<code>`
- Cal app → `https://<cal-app-url>/?code=<code>`

- If the code is expired/invalid the user sees an access-denied / `/expired` page — mint a
  fresh code (Step 1) and try again.
- Nothing else goes in the URL — all business context rides inside the code.

---

## Per-app `Data`

### Stripe Customer Dashboard — `AUD: "stripe-dashboard"`

**Required:**
- `CustomerID` — Stripe customer id, starts with `cus_`.
- `InvoiceUID` — invoice identifier (UID/GUID string).
- `AccountID` — plain string (numeric-ish like `"1"`, **not** a Stripe `acct_…`).

**Optional** (enrich the UI/emails):
- `ExtendedInfo` (object):
  ```ts
  {
    FatherName?: string; FatherEmail?: string; FatherCell?: string;
    MotherName?: string; MotherEmail?: string; MotherCell?: string;
    ParentsName?: string;   // e.g. "Mr. Boris and Mrs. Kristina Akbosh"
    SenderName?: string;    // e.g. "Rabbi Sholem Kleinman"
    SenderEmail?: string;   // e.g. "sholem@lecfl.com"
    TotalAmount?: number;
    PaymentName?: string;
  }
  ```
- `OtherPayments` (array):
  ```ts
  { PaymentDate: string; Amount: number; PaymentType: string; Description: string }[]
  ```

Example `Data`:
```json
{
  "CustomerID": "cus_RDY5fgetvZ3bt4",
  "InvoiceUID": "2BAD77DA-AB33-4D03-A455-55F9799495C0",
  "AccountID": "1"
}
```

### Cal App (scheduler) — `AUD: "cal-app"`

`Email` is **required** here (send it both as the top-level `Email` and inside `Data`).
Everything in `Data` is optional prefill for the calendar/event the user lands on — include
only what you have:

```ts
{
  email?: string;            // the @lecfl.com user (required for cal-app overall)
  calendarId?: string;
  eventId?: string;
  metadata?: Record<string, unknown>;   // e.g. { role: "teacher", school: "main" }

  // Event / calendar prefill (all optional)
  EventName?: string;
  TaskTitle?: string; TaskSubtitle?: string;
  CalendarTitle?: string; CalendarDescription?: string;
  StartDate?: string; EndDate?: string;
  StartTime?: string; EndTime?: string;
  Timezone?: string;
  Days?: number[];
  DurationMinutes?: number; IntervalMinutes?: number;
  MinBookingNotice?: number; MaxBookingsPerDay?: number;
  AvailableDaysInFuture?: number;
  Location?: string;
  EnteringInstruction?: string;
  Dept?: string;
}
```

Example `data`:
```json
{
  "email": "yschwartz_dev@lecfl.com",
  "metadata": { "role": "teacher", "school": "main" },
  "Location": "Room 204",
  "EnteringInstruction": "Knock and wait"
}
```

---

## IP allowlist

`/auth/issue` is gated by IP. The currently-allowlisted Magic servers are:

```
35.208.69.250, 34.56.181.246, 0.1.0.2, 50.250.116.233, 50.250.116.234,
67.23.68.218, 212.76.105.22, 109.253.161.90, 109.253.201.217, 67.23.68.219,
12.5.183.42, 12.5.183.44, 2a01:6500:a052:1669:4cd4:a0e7:2b4d:60a2
```
(`127.0.0.1` / `::1` are dev-only.) The check uses the **rightmost** `X-Forwarded-For` entry.
If your call gets rejected, confirm it egresses from one of these IPs.

---

## Examples (curl)

**Stripe dashboard:**
```bash
GAM_BASE_URL="https://gam-service-364894474586.us-central1.run.app"

RESPONSE=$(curl -sS -X POST "$GAM_BASE_URL/auth/issue" \
  -H "Content-Type: application/json" \
  -d '{
    "AUD": "stripe-dashboard",
    "Data": {
      "CustomerID": "cus_RDY5fgetvZ3bt4",
      "InvoiceUID": "2BAD77DA-AB33-4D03-A455-55F9799495C0",
      "AccountID": "1"
    }
  }')
# RESPONSE = {"success":true,"code":"..."}
# → send the user to:  https://stripe.lec.li/?code=<code>
```

**Cal app:**
```bash
GAM_BASE_URL="https://gam-service-364894474586.us-central1.run.app"

RESPONSE=$(curl -sS -X POST "$GAM_BASE_URL/auth/issue" \
  -H "Content-Type: application/json" \
  -d '{
    "AUD": "cal-app",
    "Email": "yschwartz_dev@lecfl.com",
    "Data": {
      "email": "yschwartz_dev@lecfl.com",
      "metadata": { "role": "teacher", "school": "main" }
    }
  }')
# RESPONSE = {"success":true,"code":"..."}
# → send the user to:  https://<cal-app-url>/?code=<code>
```
