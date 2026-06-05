# פתיחת אפליקציות LEC דרך GAM (ל‑Magic)

אותו מנגנון GAM פותח **שתי** אפליקציות:

| אפליקציה | `aud` | כתובת | `email` |
|---|---|---|---|
| Stripe Customer Dashboard | `stripe-dashboard` | `https://stripe.lec.li` | אופציונלי |
| Cal App (יומן/תיאום) | `cal-app` | `https://<cal-app-url>` *(להשלים)* | **חובה** |

עבור כל אחת מהן יש לבצע **שני צעדים**:

1. לבקש מ‑GAM קוד קצר (קריאת שרת‑אל‑שרת אחת).
2. להפנות את המשתמש לכתובת האפליקציה עם הקוד: `{APP_URL}/?code=<code>`.

זהו — **POST אחד, ואז הפניה אחת.** רק ה‑`aud`, הכתובת, ושדות ה‑`data` משתנים בין האפליקציות.

---

## צעד 1 — לקבל קוד מ‑GAM

`POST {GAM_BASE_URL}/auth/issue`

- **כתובת GAM (פרודקשן):** `https://gam-service-364894474586.us-central1.run.app`
- **הרשאה:** הקריאה חייבת לצאת מ‑IP מורשה (אחד משרתי Magic). אין צורך בטוקן.

**גוף הבקשה (JSON):**
```json
{
  "AUD": "<stripe-dashboard | cal-app>",
  "Email": "user@lecfl.com",
  "Data": { ...לפי האפליקציה, ראו למטה... }
}
```
- `AUD` — **חייב להיות בדיוק** ה‑audience של האפליקציה (`stripe-dashboard` או `cal-app`).
- `Email` — המשתמש `@lecfl.com`. **אופציונלי ל‑`stripe-dashboard`, חובה ל‑`cal-app`**
  (ה‑backend של cal דוחה טוקן ללא `Email` או שאינו `@lecfl.com`).
- `Data` — המידע שהאפליקציה מציגה, מועבר כמו שהוא לתוך ה‑session. ראו למטה לפי אפליקציה.

**תשובה תקינה:**
```json
{ "success": true, "code": "<קוד קצר>" }
```
- הקוד תקף **כ‑2 דקות**. יש לפתוח את הכתובת מיד, לא לשמור אותו.

**כשלון:** `{ "success": false, "error": "..." }` (או סטטוס לא‑2xx) — להפיק קוד חדש ולנסות שוב.

---

## צעד 2 — להפנות את המשתמש לאפליקציה

להפנות את הדפדפן של המשתמש (או לתת לו קישור) אל:

```
{APP_URL}/?code=<code>
```
- Stripe dashboard ← `https://stripe.lec.li/?code=<code>`
- Cal app ← `https://<cal-app-url>/?code=<code>`

- אם הקוד פג/לא תקין המשתמש יראה דף "אין הרשאה" / `/expired` — להפיק קוד חדש (צעד 1) ולנסות שוב.
- אין צורך להוסיף שום דבר נוסף לכתובת — כל המידע נמצא בתוך הקוד.

---

## `Data` לפי אפליקציה

### Stripe Customer Dashboard — `AUD: "stripe-dashboard"`

**חובה:**
- `CustomerID` — מזהה Stripe, מתחיל ב‑`cus_`.
- `InvoiceUID` — מזהה החשבונית (UID/GUID).
- `AccountID` — מחרוזת רגילה (ערך מספרי כמו `"1"`, **לא** `acct_…` של Stripe).

**אופציונלי** (מעשיר את ה‑UI/מיילים):
- `ExtendedInfo` (אובייקט):
  ```ts
  {
    FatherName?: string; FatherEmail?: string; FatherCell?: string;
    MotherName?: string; MotherEmail?: string; MotherCell?: string;
    ParentsName?: string;   // לדוגמה: "Mr. Boris and Mrs. Kristina Akbosh"
    SenderName?: string;    // לדוגמה: "Rabbi Sholem Kleinman"
    SenderEmail?: string;   // לדוגמה: "sholem@lecfl.com"
    TotalAmount?: number;
    PaymentName?: string;
  }
  ```
- `OtherPayments` (מערך):
  ```ts
  { PaymentDate: string; Amount: number; PaymentType: string; Description: string }[]
  ```

דוגמה ל‑`Data`:
```json
{
  "CustomerID": "cus_RDY5fgetvZ3bt4",
  "InvoiceUID": "2BAD77DA-AB33-4D03-A455-55F9799495C0",
  "AccountID": "1"
}
```

### Cal App (יומן/תיאום) — `AUD: "cal-app"`

`Email` הוא **חובה** כאן (לשלוח אותו גם ב‑`Email` ברמה העליונה וגם בתוך `Data`).
כל מה שב‑`Data` הוא prefill אופציונלי ליומן/אירוע — לכלול רק מה שיש:

```ts
{
  email?: string;            // המשתמש @lecfl.com (חובה ל‑cal-app)
  calendarId?: string;
  eventId?: string;
  metadata?: Record<string, unknown>;   // לדוגמה: { role: "teacher", school: "main" }

  // prefill לאירוע/יומן (הכול אופציונלי)
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

דוגמה ל‑`data`:
```json
{
  "email": "yschwartz_dev@lecfl.com",
  "metadata": { "role": "teacher", "school": "main" },
  "Location": "Room 204",
  "EnteringInstruction": "Knock and wait"
}
```

---

## רשימת IP מורשים

`/auth/issue` חסום לפי IP. שרתי Magic המורשים כרגע:

```
35.208.69.250, 34.56.181.246, 0.1.0.2, 50.250.116.233, 50.250.116.234,
67.23.68.218, 212.76.105.22, 109.253.161.90, 109.253.201.217, 67.23.68.219,
12.5.183.42, 12.5.183.44, 2a01:6500:a052:1669:4cd4:a0e7:2b4d:60a2
```
אם הקריאה נדחית — לוודא שהיא יוצאת מאחד מה‑IP האלה.

---

## דוגמאות (curl)

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
# ← להפנות את המשתמש אל:  https://stripe.lec.li/?code=<code>
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
# ← להפנות את המשתמש אל:  https://<cal-app-url>/?code=<code>
```
