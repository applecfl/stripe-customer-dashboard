# סקירה מלאה של המערכת — Stripe Customer Dashboard

מסמך זה מתעד **את כל מה שהמערכת יודעת לעשות** — כל feature, כל endpoint, כל כלל עסקי, כולל קוד מת ופינות ידועות. המטרה: לא להשאיר כלום בחוץ.

**טכנולוגיה:** Next.js 16 (App Router, React 19), פרוס ב-Firebase App Hosting (`stripe.lec.li`, פרויקט GCP `stripe-customer-dashboard`, us-east4 + שירות Cloud Run נוסף ב-us-central1). Deploy אוטומטי בכל push ל-`main`. דשבורד תשלומים מעל Stripe עבור מערכת בתי הספר LEC.

---

## 1. ריבוי חשבונות Stripe

כל ה-API מבוסס על `accountId` שמועבר כפרמטר בכל קריאה. משתנה הסביבה `STRIPE_LIST` הוא JSON:
```
{ [accountId]: { name, id, key, logo?, publishableKey? } }
```

חשבונות מוגדרים כיום (ID → שם):

| ID | שם | הערה |
|---|---|---|
| 1 | Registration | יש publishableKey (לקוחות אמיתיים, פרודקשן) |
| 2 | Preschool | |
| 3 | Young Division | |
| 4 | MS Boys | |
| 5 | ELM Girls | |
| 8 | Klurman | |
| 9 | Beis Chana | |
| 18 | MS Boys | שם כפול, ID אחר |
| 22 | Security | |
| 23 | Preschool | שם כפול, ID אחר |
| 25 | Head start | |
| 26 | Boys High School | |
| 30 | Dinner | |
| 31 | Maos Chitim (Tzedakah) | |
| 32 | Fuel The Staff | תרומה לקרן מורים |
| 33 | Simcha Fund | |
| 111 | RegistrationTest | חשבון טסט — יש publishableKey |

`getStripeForAccount(accountId)` מחזיר instance של Stripe מ-cache בזיכרון (לא נבנה מחדש בכל קריאה). `apiVersion: '2025-11-17.clover'`. `getStripeAccountInfo(accountId)` מחזיר רק מידע ציבורי (שם/לוגו/publishableKey) בלי החשיפה של המפתח הסודי — זה מה שמזין את ה-frontend (`GET /api/stripe/account-info`).

---

## 2. אימות (Auth) — שלוש שיטות, הכל נאכף ב-`src/middleware.ts` (Edge)

### 2.1 טוקן HMAC ב-URL (`?token=`) — השיטה הישנה
פורמט `payload.signature` (base64url), HMAC-SHA256 עם `AUTH_SECRET`. ה-payload:
```
{customerId, invoiceUID, accountId, userType?, exp, iat, kind?, amount?, dynamic?, extendedInfo?, otherPayments?, plan?}
```
- **dashboard token**: תוקף 30 דקות, מתרענן אוטומטית כל 25 דקות מה-UI (`/api/auth/refresh-token`) לפני שפג.
- **payment_link token** (`kind:'payment_link'`): תוקף 7 ימים, חד-פעמי (נאכף ב-Firestore, לא ב-middleware). נושא סכום **קבוע וחתום** — הלקוח לעולם לא יכול לתפעל כמה הוא ישלם.
- **dynamic payment link** (`dynamic:true`): בלי סכום קבוע — השרת מחשב בכל ביקור את היתרה הפתוחה החיה (`getOutstandingForUID`).
- Payload יכול לשאת גם `plan` (תוכנית תשלומים — ראה סעיף 8) ו-`extendedInfo`/`otherPayments` (מידע מורחב ממערכת חיצונית — שם/אימייל/טלפון הורים, שולח, סכום כולל, תשלומי Zelle/Cash).
- **`userType`** (נוסף 2026-11-12): שדה אופציונלי ברמת ה-payload (לא בתוך `extendedInfo`) — מי השולח ב-Magic (למשל `'M'` = Mother). מגיע מ-`Data.UserType` בטוקן ה-GAM (וגם נתמך בנתיב ה-HMAC הישן דרך `generate-token`), עובר כ-`userType` דרך `/api/auth/me`/`decodeTokenPayload` ל-`page.tsx`, ומשם ל-`TuitionStatementModal` ↠ `POST /api/stripe/tuition-statement` ↠ נשלח ל-Magic בתור `UserType` בתוך קריאת `CreateTuitionStatement` **רק אם קיים** (לא נשלח כלל כש-undefined, כדי לא לשבור טוקנים ישנים בלי השדה).

פונקציות מרכזיות (`src/lib/auth.ts`):
- `generateToken()` — dashboard token.
- `generatePaymentLinkToken(amount, plan?)` — payment_link, סכום+plan חתומים.
- `generateDynamicPaymentLinkToken()` — payment_link בלי סכום קבוע.
- `getTokenSignature(token)` — מחלץ את חתימת הטוקן כמפתח ייחודי (ל-Firestore, single-use).
- `verifyToken()` — אימות + תפוגה + שדות חובה.
- `verifyTokenAllowExpired()` — **רק** לתמונת הכפתור במייל (PNG): מאמת חתימה אך סובל תפוגה כדי להציג כפתור אפור "פג תוקף"; קורא **חייב** לבדוק את דגל ה-expired.

### 2.2 GAM Session Cookie (RS256) — SSO מרכזי (צוות יוסף)
Cookie בשם `gam_session`, httpOnly. `?code=` ב-`/` מוחלף שרת-לשרת מול `GAM_BASE_URL/auth/exchange` ל-access token, שנשמר כ-cookie; אז redirect לכתובת נקייה. אימות: RS256 מול JWKS (`GAM_BASE_URL/.well-known/jwks.json`), עם cache לפי `kid` ו-refetch אוטומטי ב-miss, ומניעת race (`inflight-dedup`). בודק `exp`, `AUD==='stripe-dashboard'`, `Typ==='access'`. `GET /api/auth/me` הוא ה-endpoint שקורא את ה-cookie ומחזיר את קונטקסט העסקי (`customerId, invoiceUID, accountId, extendedInfo, otherPayments, email, expiresAt`) מבלי לחשוף טוקן ל-client. עובד **רק** בשטח הדשבורד — לא בפני pay-link.

### 2.3 IP Whitelist
מגן על `generate-token` ועוד endpoints תשתית. `isClientChainAllowed` מודע ל-Cloudflare: בודק את **כל** שרשרת `x-forwarded-for`/`cf-connecting-ip` (לא רק hop ראשון) כדי למנוע spoofing. `isInfraHop` מתיר רק טווחי Google/RFC1918 ספציפיים — בכוונה **לא** 35.0.0.0/8 (שם יושבות גם מכונות לקוח → ניתן לזיוף).

### 2.4 כללי ניתוב (middleware kind-per-route)
- `payment_link` token פותח **רק** `/pay` + `/api/stripe/pay-link*`.
- `dashboard` token / GAM cookie פותחים את כל השאר תחת `/` + `/api/stripe/*`.
- אכיפה הדדית: טוקן מסוג לא-מתאים לנתיב → נדחה (401 ל-API, redirect ל-`/expired` לדף). כך לינק תשלום דלוף לא יכול לפתוח את כל הדשבורד, ולהפך.
- **Exempt לגמרי (אין גייט):** `/expired`, `/api/auth/generate-token`, `/api/stripe/payments/update-uids`, `/api/stripe/debug-key`, `/api/stripe/pay-link/button`, `/api/stripe/pay-link/amount` (תמונות שחייבות לרנדר גם עם טוקן שפג), `/api/stripe/gotenberg-warm` (keep-warm cron), קבצים סטטיים.

### 2.5 endpoints נוספים
- **`POST /api/auth/generate-token`** — מוגן IP whitelist בלבד. מקבל `CustomerID, InvoiceUID, AccountID` + מידע מורחב. עם `Kind='payment_link'` + `Amount` → מנפיק payment_link token; אחרת dashboard token.
- **`POST /api/auth/refresh-token`** — מאמת טוקן קיים, **חוסם מפורשות payment_link** (מניעת הסלמת הרשאות — לינק תשלום לא יכול "להתקדם" לטוקן דשבורד מלא), מנפיק dashboard token חדש.

---

## 3. מבנה הדשבורד (`src/app/page.tsx`)

**טעינת קונטקסט:** טוקן ב-URL (legacy, מפוענח בצד לקוח) **או** cookie mode (`isCookieMode = !token`, הנתונים מגיעים מ-`/api/auth/me`). הטוקן מתרענן כל 25 דקות.

**טעינת דאטה:** 4 קריאות מקבילות — `customer/[id]`, `invoices`, `payments`, `payment-methods`. 401 מכל אחת → ניתוב ל-`/expired`.

**טאבים:** Failed (ברירת מחדל; אם ריק → עובר אוטומטית ל-Success) / Success / Future (draft) / Payment Methods. `FailedPaymentsTable` תמיד מורכב ב-DOM (`hidden` CSS בלבד) כדי לשמר cache של payment-attempts שכבר נטענו.

### חישוב Outstanding (זהה ב-page.tsx וב-CustomerHeader)
- **paid** = תשלומי Stripe שהצליחו (פחות refund) **+** `otherPayments` (Zelle/Cash/Check — מגיעים דרך הטוקן, לא מ-Stripe).
- **scheduled** = סכום כל חשבוניות ה-draft (עם fallback ל-subtotal/total/lines אם `amount_due=0`).
- **failed** = חשבוניות open עם `attempt_count>0` — **לתצוגה בלבד**, **לא מופחת** מה-outstanding (כי זה עדיין חוב פתוח).
- **total** = מהטוקן (`extendedInfo.totalAmount`) אם קיים, אחרת `paid+scheduled+failed`.
- `outstanding = max(0, total - paid - scheduled)`. שלילי → מוצג "Overpaid".

---

## 4. ניהול חשבוניות (Invoices) — כל ה-endpoints

| Endpoint | מה הוא עושה |
|---|---|
| `GET /api/stripe/invoices` | כל חשבוניות הלקוח (pagination מלא), סינון אופציונלי לפי `invoiceUID` (תומך `InvoiceUID`/`invoiceUID`). |
| `POST /api/stripe/invoices/create` | **לא** פונה ל-Stripe ישירות — proxy ל-API חיצוני `EXTERNAL_API_URL/stripe/createFutureInvoices` (ברירת מחדל `webhook.lec.li`) ליצירת סדרת חשבוניות (שבועי/דו-שבועי/חודשי/תאריכים מותאמים). זה המנוע מאחורי "Multi Payment". |
| `POST /api/stripe/invoices/create-draft` | יוצר draft בודד עם `automatically_finalizes_at` לתזמון מדויק. מקבל `sourceInvoices[]` (או `sourceInvoice` יחיד, legacy): **מבטל** (void) את כל חשבוניות המקור קודם (למשל reschedule של נכשל), מעתיק את המטא-דאטה שלהן לדראפט החדש + `sourceInvoiceId` (רשימה מופרדת בפסיקים) + `voidReason`. |
| `POST /api/stripe/invoices/schedule` | מעדכן draft **קיים** עם `automatically_finalizes_at` חדש + `scheduledFinalizeAt` במטא-דאטה. |
| `POST /api/stripe/invoices/adjust` | שינוי סכום. **draft**: מוחק את כל ה-invoiceItems ויוצר חדש בסכום המלא. **open**: אפשר רק **להקטין** (לא להגדיל) — מבטל PaymentIntent תלוי אם קיים, ואז יוצר credit note; אם נכשל (תשלום pending) — fallback ל-ביטול+יצירה-מחדש או לקרדיט ברמת הלקוח. |
| `POST /api/stripe/invoices/payment-method` | מעדכן `default_payment_method` על draft/open. |
| `GET /api/stripe/invoices/[invoiceId]` | חשבונית בודדת עם `lines` מורחב. |
| `POST /api/stripe/invoices/[invoiceId]` | תשלום. **מלא**: `stripe.invoices.pay()` ישירות. **חלקי**: PaymentIntent נפרד, ואז credit note כדי להקטין `amount_remaining` + היסטוריה ב-metadata. |
| `PATCH /api/stripe/invoices/[invoiceId]` | multi-action switch — ראה פירוט למטה. |
| `DELETE /api/stripe/invoices/[invoiceId]` | מוחק **draft בלבד**. |
| `GET /api/stripe/invoices/[invoiceId]/attempts` | היסטוריית ניסיונות תשלום, 4 מקורות בסדר נפילה: charge ישיר על ה-invoice → charges דרך payment_intent → charges/PIs של הלקוח שמתייחסים לחשבונית (metadata) → אירועי `invoice.payment_failed/succeeded` (30 יום אחורה) → fallback placeholder לפי `attempt_count` אם אין מידע אחר. |

### פעולות `PATCH /invoices/[invoiceId]` (action switch):
- **`pause`/`unpause`** — draft: מכבה `auto_advance`, שומר תאריך מקורי לשחזור. open: מכבה `auto_advance` לעצירת ניסיונות גבייה אוטומטיים של Stripe, שומר payment method מקורי.
- **`adjust`** — draft בלבד, מוסיף invoiceItem שלילי.
- **`finalize`** — הופך draft ל-open.
- **`retry`** — ניסיון תשלום חוזר על חשבונית open שנכשלה (אותה חשבונית, לא חדשה). אם נדרש 3DS — מאתר את ה-PaymentIntent הרלוונטי ומחזיר `clientSecret` לטיפול בדפדפן.
- **`void`** — מבטל חשבונית open ספציפית **בלבד** (לוגים מפורשים שמדגישים שלא נוגעים באחרות). אופציונלי `addCredit` — קרדיט שלילי בגובה היתרה שנותרה.
- **`change-payment-method`** / **`change-due-date`** (draft בלבד) / **`send-reminder`** (אימייל Stripe מובנה) / **`update-note`** (מטא-דאטה חופשית).

---

## 5. שני מסלולי תשלום — Pay-Now (צוות) מול Pay-Link (לקוח)

### 5.1 `distributePayment()` — ליבת חלוקת תשלום (`src/lib/payNowCore.ts`)
פונקציה משותפת: לוקחת PaymentIntent **שכבר הצליח** ומפזרת אותו על חשבוניות הלקוח.

**`resolveInvoicesToPay`** — קביעת סדר החשבוניות:
1. אם `selectedInvoiceIds` נשלח — זה הסדר הסופי.
2. אחרת, אם `applyToAll` — שולף open+draft, מסנן לפי `InvoiceUID`, וממיין: **נכשלות קודם** (open, `attempt_count>0`, הישנה ביותר קודם), **אז drafts** (לפי תאריך תזמון הקרוב ביותר).
3. אחרת — ריק, לא עושה כלום.

**הלולאה לכל invoice (כל עוד נשאר סכום):**
- מחשב `amountToApply = min(remainingAmount, invoiceAmount)`.
- בונה `paymentHistory` (מצטבר ב-metadata: PI id, סכום, סיבה, תאריך, type).
- **Draft ששולם במלואו** → `stripe.invoices.del()` — **נמחק לגמרי**. אם המחיקה נכשלת → fallback: מעדכן metadata בלי למחוק.
- **Draft ששולם חלקית** → `invoiceItems.create({amount: -amountToApply})` — שורת זיכוי שלילית.
- **Open ששולם במלואו** → `voidInvoice()`. נכשל → fallback ל-`creditNotes.create` מלא.
- **Open ששולם חלקית** → `creditNotes.create` חלקי.
- בסוף: ה-PaymentIntent עצמו מתעדכן ב-metadata עם סיכום (`invoicesPaid`, `invoiceNumbersPaid`, `invoiceAmounts`, `totalAppliedToInvoices`).

**למה לא "Paid" פשוט:** אין charge ישיר על ה-invoice (התשלום הוא PaymentIntent נפרד) — אז אין דרך Stripe-ית לסמן invoice כ"שולם" ישירות; לכן void/delete + רישום בהיסטוריה הם ה"תחליף".

> ⚠️ **הנחיית שלום (קריטית):** `distributePayment` חייבת להבדיל בין שני הקשרים — **תשלום לחשבונית ספציפית** (retry וכו') → מותר לגעת בה; **בקשת תשלום סטנדאלונית מהמשרד** (סכום שרירותי, לא קשור לחשבונית מסוימת) → **אסור** לגעת בחשבוניות אחרות של הלקוח. זו הסיבה ש-pay-now (dashboard) מעביר `selectedInvoiceIds`/`applyToAll` מבוקר-אדמין, ואילו pay-link (לקוח) **לא מריץ `distributePayment` בכלל**.

### 5.2 Pay-Now (`/api/stripe/pay-now` + `/pay-now/finalize`) — מופעל ע"י הצוות
יוצר PaymentIntent בודד (confirm מיידי) → `distributePayment` עם selectedInvoiceIds/applyToAll מהדשבורד. 3DS → מחזיר `requiresAction`+`clientSecret`; `/pay-now/finalize` מריץ את אותה `distributePayment` אחרי אישור בדפדפן.

### 5.3 Pay-Link (`/api/stripe/pay-link` + `/pay-link/finalize`) — הלקוח מה-`/pay` הציבורי
מודל **מונה יורד עצמאי ב-Firestore** (`payment_links` collection) — **לא נוגע בחשבוניות אחרות בכלל**:
1. מאמת טוקן מחדש בשרת (defense in depth).
2. תומך בתוכנית תשלומים (ראה סעיף 8) — אם נבחרו מספר תשלומים, מחשב מחדש **בשרת** (לעולם לא סומך על לקוח), גובה רק תשלום #1, **כופה saveCard**.
3. `getOrInitLink`/`getChargeableAmount` — מאתחל מונה ב-ביקור ראשון, מגביל חיוב למה שנותר.
4. בדיקת בעלות אמצעי תשלום: PM ששייך ללקוח אחר → נדחה. לא משויך → כרטיס חדש.
5. `idempotencyKey` ייחודי (sig+pm+amount+plan) למניעת כפילות; metadata `payLinkSig` קושר PI ← לינק.
6. 3DS → `clientSecret`; לאחר אישור, `/pay-link/finalize` מוודא ש-PI שייך לאותו sig+customer, ואז מתזמן המשך תוכנית (אם יש) או פשוט מקטין את המונה ב-Firestore (`commitPayment`).

`GET /pay-link` מחזיר `{remaining, amount, alreadyPaid}` לדף `/pay`.

**מודל הקישור:** Fixed (סכום קבוע) / Dynamic (`dynamic=true`, הלקוח יכול לערוך/להקטין עד יתרה חיה) / Plan (תוכנית תשלומים).

---

## 6. תשלומים, זיכויים, אמצעי תשלום

| Endpoint | מה הוא עושה |
|---|---|
| `GET/PATCH/POST /api/stripe/payments` | GET: מאחד PaymentIntents + paid invoices + אירועי out-of-band, מיפוי PI↔invoice מ-3 מקורות, סינון לפי invoiceUID. PATCH: עדכון הערה על PI. POST: תשלום חד-פעמי בלי שמירת כרטיס (אופציונלי `setup_future_usage`). |
| `GET/POST /api/stripe/refunds` | GET: כל ה-refunds של הלקוח. POST: יצירת refund (מלא/חלקי, סיבה מרשימה סגורה), מסמן על ה-PI `metadata.refunded='true'`+`refundId`. **הערה:** המערכת קובעת "מוחזר" לפי `metadata.refunded==='true'` — **לא** לפי שדה Stripe אמיתי. ראה [סעיף 11](#11-תיקון-ידני-pending---backfill-של-refunds). |
| `GET/POST/PATCH/DELETE /api/stripe/payment-methods` | CRUD כרטיסים: רשימה (isDefault לפי `invoice_settings.default_payment_method`), הוספה (attach + setAsDefault אופציונלי), עדכון ברירת מחדל, מחיקה (detach). |
| `POST /api/stripe/add-credit` | יוצר balance transaction שלילי (קרדיט) ברמת לקוח, מפזר על חשבוניות (selectedInvoiceIds/applyToAll ממוין due_date) — draft: סימון מטא-דאטה בלבד; open: `stripe.invoices.pay()` (גם חלקי). **⚠️ אין לו שום Trigger ב-UI החי כיום (ראה סעיף 9).** |
| `GET /api/stripe/account-info` | שם/לוגו/publishableKey מ-`STRIPE_LIST` לפי accountId (ללא fallback). |
| `GET/POST/PATCH /api/stripe/customer/[customerId]` | GET: לקוח + balance transactions + default PM. POST: קרדיט ישיר. PATCH: pause/unpause **כל** החשבוניות open של הלקוח (מסונן invoiceUID) ע"י שינוי `collection_method` (charge_automatically↔send_invoice). |
| `GET /api/stripe/debug-key` | חשוף ללא אימות (IP-whitelist כנראה) — כלי דיבאג פנימי. |

---

## 7. ממשק המשתמש (Dashboard UI)

### `CustomerHeader.tsx`
אווטאר+שם, "Customer since", `invoiceUID` עם העתקה, פרטי הורה/אם (אם קיימים — mailto:/tel: links), סכום Total גדול. **כפתורי פעולה:** Charge, Multi Payment, Add Card, Create Statement, Payment Request. **4 כרטיסי סיכום לחיצים** (מובילים לטאב המתאים): Successful, Scheduled, Failed (מידע בלבד), Outstanding/Overpaid.

### `FailedPaymentsTable.tsx` — חשבוניות open עם `attempt_count>0`
ממוין מהחדש לישן. פעולות לכל שורה:
- **עריכת סכום inline** — רק הקטנה (דרך `/invoices/adjust`, credit note חלקי).
- **הערה (inline)** — `PATCH action:'update-note'`.
- **Retry** → `RetryPaymentModal` (חיוב חוזר ישיר על אותה חשבונית, כולל 3DS מלא).
- **Email (Send Reminder)** → `SendReminderModal`.
- **Make Payment** → `PaymentModal` עם החשבונית הזו (pay now או reschedule).
- **Pause/Resume Auto-retry** — עוצר/מחדש ניסיונות retry אוטומטיים של Stripe.
- **Void** → `VoidInvoiceModal`.
- **הרחבה (chevron)** — Payment Attempts מלא (`/invoices/[id]/attempts`): קוד שגיאה, הודעה, פרטי כרטיס, תאריך, outcome, קישור ל-Stripe Dashboard.

### `DraftInvoicesTable.tsx` (export כ-`FutureInvoicesTable`) — חשבוניות draft
ממוין לפי תאריך גבייה קרוב. חשבונית paused שומרת תאריך "אמיתי" בתוך ה-note (`[Scheduled: ...]`).

**עריכה inline לכל שורה** (pending changes לפני Save): סכום (`adjust`), תאריך גבייה (`schedule`), כרטיס (`payment-method`), הערה (`update-note`).
**פעולות per-row:** Pause/Resume, Delete, Add Note.
**בחירה מרובה + toolbar bulk:** Change Amount (לכולם), Change Date (הראשון מקבל את התאריך שנבחר, הבא+חודש וכן הלאה), Change Card, Pause/Resume, Delete.

### `SuccessfulPaymentsTable.tsx`
משלב: תשלומי Stripe שהצליחו + "Other Payments" (Zelle/Cash/Check — לא מ-Stripe, מהטוקן, אייקון ייעודי לZelle). כל שורה ניתנת להרחבה: אילו חשבוניות שולמו ע"י התשלום (ממטא-דאטה), קרדיט שנוסף, הערה, `ScreenshotLink`. כפתור **Refund** (לתשלומי Stripe בלבד). תגית "Fully Refunded". עריכת הערה inline.

### `PaymentMethodsTable.tsx`
רשימת כרטיסים, "Set as Default", אילו חשבוניות מקושרות לכל כרטיס (כולל תגית "Failed"), מחיקה/מחיקה מרובה, "Add Card", וכפתור bulk "Change Payment Method for All Payments".

### `ScreenshotLink.tsx`
כפתור אייקון (לוגו "Authorization.png") שפותח מודל עם URL חתום-זמני לקובץ הוכחת-תשלום (bucket חיצוני `lec-records`). תמונה: zoom in/out/reset (0.5x–5x). PDF: iframe. caching של ה-URL בתוך אותו session של המודל.

### המודלים (Modals)

| מודל | תפקיד |
|---|---|
| **PaymentModal** | שני מצבים: תשלום מיידי (PaymentIntent חדש) או **Schedule mode** — יוצר draft חדש (`create-draft`) ומבטל (void) כל חשבונית failed שנבחרה בפועל. |
| **RetryPaymentModal** | חיוב חוזר מיידי על אותה invoice (לא schedule), 3DS מלא, אפשרות כרטיס חדש inline. |
| **VoidInvoiceModal** | אישור + reason אופציונלי. **לא** מוסיף קרדיט בכוונה (קומנט בקוד: משפיע על חשבוניות draft אחרות). |
| **AddPaymentMethodModal** | טופס כרטיס (Stripe Elements), attach ל-customer, "Set as default". |
| **ChangePaymentMethodModal** (bulk) | Stripe Elements לכרטיס חדש + "Remove card"; חל על כל ה-open+draft. (variant single — קוד מת, ראה סעיף 9). |
| **CreateInvoiceModal ("Multi Payment")** | יוצר **סדרה** של draft שמחלקת סכום כולל שווה בשווה — Weekly/Bi-Weekly/Monthly (cycles או תאריך סיום) או Custom Dates, עם preview חי. שולח ל-`/invoices/create`. |
| **RefundModal** | החזר מלא/חלקי, סיבה (duplicate/fraudulent/requested_by_customer), הערה פנימית, checkbox אישור. |
| **SendReminderModal** | עורך HTML (בולד/איטלי/לינק/רשימה), נמענים אוטומטיים מ-`extendedInfo` (father/mother/customer email), נושא ברירת מחדל, שולח ל-`/api/send-reminder`. |
| **TuitionStatementModal** | שני מצבים: **Statement** (HTML→PDF דרך Gotenberg, מצורף, כפתור תשלום אופציונלי) ו-**Payment Request** (מייל קצר, **תמיד** עם כפתור תשלום, ללא PDF, כולל אפשרות להציע **תוכנית תשלומים**). |

---

## 8. תוכניות תשלום (Payment Plans / Installments) — פיצ'ר

המשרד יכול להציע ללקוח **פריסה לתשלומים חודשיים** על Payment Request. המשרד קובע *מספר תשלומים מקסימלי* + *תאריך סיום*; הלקוח ב-`/pay` בוחר כמה (1 עד המקסימום), משלם תשלום #1 עכשיו (כרטיס נשמר), וה-N-1 הנותרים מתוזמנים כחשבוניות עתידיות שStripe גובה אוטומטית.

**החלטות קבועות:**
- קצב: **חודשי** בלבד, קבוע. תשלום #1 = היום, ואז אותו יום-בחודש כל חודש.
- מקסימום: נגזר **מתאריך הסיום** — כמה חודשים שלמים נכנסים בין היום לתאריך הסיום. קלט ה"מקס" של המשרד נחתך לפי זה.
- הבוחר: **הלקוח**, ב-`/pay` (כל ערך 1..מקס; 1 = תשלום מלא היום).
- לעולם לא מעבר לתאריך הסיום.
- פיצול שארית: הסנטים העודפים הולכים ל**תשלום הראשון** (הנגבה היום) — כדי שהלקוח לא יופתע מתשלום אחרון גדול יותר.
- תשלום #1 תמיד דרך pay-link הקיים (3DS + שמירת כרטיס); #2..N נוצרים ע"י המנוע החיצוני.

**אנחנו לא בונים scheduler חדש** — המנוע הקיים `lecapp-webhooks` (`POST webhook.lec.li/stripe/createFutureInvoices`) כבר יודע לעשות את זה (קצב חודשי, סכומים לכל תאריך, `default_payment_method`, `automatically_finalizes_at`).

### המשרד (TuitionStatementModal, payment mode)
- "Offer a payment plan" toggle. שני שדות: **Max installments** (2–12) ו-**Final payment by** (תאריך). הכל אחר נגזר — אין קלט ידני לסכומים/תאריכים ביניים.
- פריוויו חי: "up to 4 monthly payments, finishing by Dec 1, 2026" + דוגמה מספרית. אזהרה אם פחות חודשים נכנסים מהמבוקש. חוסם אם תשלום בודד יורד מתחת למינימום Stripe (~50¢).

### הטוקן
`plan: {maxInstallments, endDate}` — חתום, tamper-proof. `amount` נשאר הסכום הכולל. **הסכומים/תאריכים הספציפיים לכל תשלום אינם חתומים** — מחושבים דטרמיניסטית בשרת מ-(total, endDate, הבחירה, תאריך היום) כך שהלקוח לעולם לא יכול להכתיב אותם.

### הלקוח (`/pay`)
בוחר "Pay in full" (ברירת מחדל, בטוח) או "Split into monthly payments" (סלקטור 2..max, פריוויו חי של סכום+תאריכים). כפתור התשלום משקף את הבחירה. כרטיס נשמר **בהכרח** כשנבחרה פריסה (נדרש לחיוב עתידי off-session).

### המימוש
- **`src/lib/installments.ts`** (חישוב טהור): `maxMonthlyInstallments(now, endDate)`, `buildPlan(total, count, now, endDate)` — מחזיר `Installment[]` (index, amount, date). חישוב מבוסס אזור זמן **America/New_York** (ללא ספריית tz חיצונית — `Intl.DateTimeFormat`), עם clamp ליום אחרון בחודש וליום-העוגן.
- **`src/lib/plan.ts`** — `schedulePlanRemainder()`: רץ **אחרי** הצלחת תשלום #1. מאמת מחדש (שרת) את buildPlan, שולף את אמצעי התשלום מה-PI שהצליח, **אידמפוטנטי** (`claimPlanScheduling` — transaction ב-Firestore, רק caller ראשון מצליח), קורא ל-`createFutureInvoices` עם `Frequency:'Dates'`, `Dates[]`, `Amount[]` (מערך סכומים), `FirstPaymentNumber:2`. כשל → `releasePlanScheduling` (לא מכשיל את תשלום #1 שכבר בוצע; ניתן לנסות שוב).
- **pay-link route** מפעיל את ה-schedule לאחר ההצלחה (או אחרי 3DS ב-finalize). מונה הלינק מתאפס ל-0 לאחר בחירת תוכנית (הלינק "מומש", השאר חי בחשבוניות עצמן).
- **`collectPlanScheduled`** נשמר ב-Firestore לצורך idempotency + `scheduledInvoiceIds` למעקב.

**הנחיית שלום חלה גם כאן:** החשבוניות העתידיות הן **חדשות**, ספציפיות ל-InvoiceUID הזה — לעולם לא נוגעים בחשבוניות אחרות לא קשורות של הלקוח.

מתועד גם ב-`PAYMENT-PLAN-FEATURE.md` (בשורש הפרויקט) עם טבלת כל הקבצים שהשתנו.

---

## 9. ⚠️ קוד מת — רכיבים מוגדרים אך לא בשימוש בפועל

נמצאו ב-`src/components/dashboard/index.ts` רכיבים ש-**מיוצאים ומוגדרים אך אף אחד לא קורא להם בפועל** מה-UI החי:
- `InvoicesTable.tsx`, `PaymentsTable.tsx`, `TransactionsTable.tsx` — טבלאות legacy.
- `PayNowModal.tsx`, `PayInvoiceModal.tsx`, `OneTimePaymentModal.tsx`, `AddCreditModal.tsx` — מודלים legacy (כולל `POST /api/stripe/add-credit` שאין לו קורא פעיל מה-UI).
- `NoteButton.tsx`.
- **`AdjustInvoiceModal`** — מורכב ב-`page.tsx` אבל `setAdjustInvoiceModal(...)` **לא נקרא עם ערך בשום מקום** — אין כפתור פותח. עריכת סכום נעשית inline בטבלאות עצמן.
- **`ChangeDueDateModal`** (single וגם bulk) — מורכב אך **אין opener בכלל**. שינוי תאריך נעשה inline ב-`DraftInvoicesTable`/`FutureInvoicesTable`.
- **`ChangePaymentMethodModal`** single mode — אין opener; רק bulk variant פעיל.

**משמעות:** אם מישהו רוצה "לתקן" את אחד המודלים האלה — חשוב לבדוק קודם אם בכלל יש אליו דרך הגעה מה-UI, אחרת זה מאמץ על קוד שאינו נגיש למשתמש.

---

## 10. PDF, Email ומערכות חיצוניות

### 10.1 Gotenberg (HTML→PDF)
שירות Cloud Run **פרטי** (`gotenberg`, us-central1, image רשמי `gotenberg/gotenberg:8`). גישה דרך **Google OIDC ID token** (audience = ה-URL של Gotenberg), לא API key (הוחלף אחרי שה-image המותאם-אישית נכשל עם "websocket url timeout reached"). `src/lib/gotenberg-auth.ts` שולף טוקן ממטאדאטה (`metadata.google.internal`), cache ~50 דקות. לוקלית (ללא metadata server) — headers ריקים.

- `POST /api/stripe/generate-pdf` — מקבל HTML, מנקה תווי encoding פגומים, שולח ל-`/forms/chromium/convert/html` (A4, printBackground), מחזיר PDF כ-base64.
- `GET /api/stripe/gotenberg-warm` — keep-warm endpoint (ציבורי, ללא auth) שנקרא ע"י **Cloud Scheduler** (`gotenberg-keep-warm`, `*/4 7-20 * * 0-5` America/New_York — כל 4 דק', א'-ו' 7-20) כדי למנוע cold-start (~8 שנ') של קונטיינר Chromium. ראה `GOTENBERG-HTML-TO-PDF-ACCESS.md` להוראות הענקת גישה למערכות נוספות.

### 10.2 יצירת/שליחת סטטמנט (Tuition Statement)
- `POST /api/stripe/tuition-statement` — קורא ל-Magic (`runServerCommand`, `CreateTuitionStatement`) שמחזיר HTML בנוי-מראש (לא Next.js בונה אותו). מקבל `invoiceUID` (חובה) ו-`userType` (אופציונלי, מהטוקן — ראה סעיף 2.1) שמועבר ל-Magic כ-`UserType` רק כשקיים.
- `POST /api/stripe/send-tuition-statement` — הגדול והמורכב: מקבל את כל פרטי המייל + PDF base64 + (אופציונלי) `plan`. אם `includePayButton` — מאמת `plan` (תאריך עתידי, מקסימום≥2, כל תשלום≥50¢), מנפיק payment_link token חד-פעמי, בונה 3 URLs (payUrl, imgUrl=כפתור PNG חי, amountImgUrl=יתרה PNG חיה). **הכפתור וה-balance הם תמונות שנרנדרות בזמן פתיחת המייל** (לא בזמן השליחה) כך שמשקפות מצב עדכני (כחול=פעיל / אפור=פג-תוקף-שולם); alt text מציג סכום-בזמן-שליחה כ-fallback. שליחה: **Gmail API** (service account + domain-wide delegation) אם מוגדר, אחרת fallback ל-**Nodemailer** (SMTP + App Password).
- `POST /api/send-reminder` — אותה תשתית Gmail/Nodemailer, ייעודי לתזכורות על חשבוניות שנכשלו (`FailedPaymentsTable` → `SendReminderModal`).

### 10.3 Magic/Connect (`src/lib/server-command.ts`)
קורא ל-`http://12.5.183.44:5782/API/` (שרת "Magic" פנימי) דרך FormData (`APPNAME`, ברירת מחדל "SERVER" / בפרודקשן "Connect"; `PRGNAME`; `ARGUMENTS`). **התגובה מגיעה ב-UTF-16LE** (מפוענחת ב-`TextDecoder`) — תלות במערכת ישנה (כנראה Windows/VB/FoxPro). משמש גם ב-`tuition-statement` וגם ב-`payments/update-uids`.

### 10.4 Screenshot feature
`metadata.ScreenShotFile` (GUID בלבד, בלי סיומת) — נכתב ע"י Magic בעת יצירת חשבונית עם תמונת הוכחה; **לא** נכתב ע"י האפליקציה הזו, רק עובר ב-metadata.
- קובץ חי ב-bucket **`lec-records`** (פרויקט **לא קשור** `lecfl-59ccf`), אובייקט בנתיב `Uploads/<GUID>.<ext>` (ext∈png/jpg/jpeg/pdf — לא תמיד ידוע מראש).
- **IAM cross-project:** ה-SA של הדשבורד קיבל `roles/storage.objectViewer` על `gs://lec-records`.
- `getRecordsSignedUrl` (ב-`src/lib/firestore.ts`) מנסה מספר candidate paths לפי סדר (ערך גולמי → `Uploads/<name>` → `Uploads/<name>.{ext}` → `<name>.{ext}`) וחותם v4 URL (5 דק') לראשון שקיים.
- `GET /api/stripe/screenshot?file=<GUID>` — מוגן ב-regex קפדני `^[A-Za-z0-9._-]{1,128}$` (מניעת path traversal), מוגן ע"י ה-middleware הרגיל.
- `ScreenshotLink.tsx` — כפתור אייקון בטבלאות Successful/Transactions/Payments, מודל עם zoom לתמונות / iframe ל-PDF.

### 10.5 מנוע חשבוניות עתידיות חיצוני (`lecapp-webhooks`)
`POST webhook.lec.li/stripe/createFutureInvoices` — מנוע בפרודקשן המשותף גם ל-"Multi Payment" (`/invoices/create`) וגם לתוכניות תשלום (`schedulePlanRemainder`). תומך `customDates` (מערך `Dates`+`Amount` לכל תאריך, אינדקס 0=היום מחויב מיידית) או `frequency+cycles` (Daily/Weekly/Bi-Weekly/Monthly/Scheduled, עם `lastPaymentAmount` לטיפול בשארית בתשלום האחרון). כל התאריכים ב-America/New_York (luxon).

---

## 11. תיקון ידני Pending — Backfill של Refunds

`STRIPE-REFUND-BACKFILL.md` (בשורש הפרויקט) מתאר משימה **ממתינה** לבוט אוטומציה: המערכת קובעת "מוחזר" לפי `PaymentIntent.metadata.refunded==='true'` (דגל מותאם-אישית) ולא לפי מצב Stripe אמיתי — אז refund שנוצר **מחוץ לדשבורד** (למשל ישירות ב-Stripe Dashboard) לא יופיע באפליקציה. המשימה: לעבור על כל ה-Charges עם `amount_refunded>0`, לאתר את ה-PaymentIntent שלהם, ולהוסיף את הדגל (אידמפוטנטי, merge בלבד — לא דורס metadata אחר). **תיקון שורש מועדף לעתיד:** לזהות refund לפי `charge.amount_refunded>0` במקום הדגל המותאם — כך שלא יידרש backfill נוסף לעולם.

---

## 12. טייפוסים מרכזיים (`src/types/index.ts`)

- **`InvoiceData`** — עטיפת `Stripe.Invoice`: amount_due/paid/remaining, status, metadata, `lines[]`, ושדות נגזרי-metadata: `isPaused, originalDueDate, adjustmentNote, note`; שדות מצב-תשלום: `last_payment_error{code,message,decline_code}, next_payment_attempt, attempt_count, auto_advance, automatically_finalizes_at, effective_at`.
- **`PaymentData`** — עטיפת PaymentIntent: `amount_refunded, refunded` (מה-metadata flag, ראה סעיף 11), `invoice/invoiceNumber`, `refund_reason`, `payment_method{card{brand,last4,exp_month,exp_year}}`.
- **`PaymentMethodData`**, **`RefundData`**, **`CreditBalanceTransaction`**, **`DashboardData`** (אגרגציה).
- **`ExtendedCustomerInfo`** — מידע הורים/שולח, מגיע מהטוקן (ממערכת חיצונית).
- **`OtherPayment`** — תשלומי Zelle/Cash/Check חוץ-Stripe, גם הם מהטוקן.
- **`ApiResponse<T>`** — `{success, data?, error?}`, המעטפת האחידה לכל ה-API.
- **`InvoiceFrequency`** / **`CreateInvoicesRequest`** — תואם למנוע החיצוני `createFutureInvoices`.

---

## 13. פונקציות עזר כלליות

- **`src/lib/mappers.ts`** — `mapInvoice`/`mapPaymentIntent`: ממפים את טייפוסי Stripe הגולמיים לטייפוסי האפליקציה (כולל שליפת שדות לא-רשמיים כמו `invoice` על PI דרך type assertion).
- **`src/lib/balance.ts`** — `getOutstandingForUID`: יתרה **חיה** (לא cached) לInvoiceUID — סכום `amount_remaining` על open+attempt_count>0 תואמות UID. מקור האמת ל-dynamic pay-link.
- **`src/lib/emailTemplate.ts`** — תבניות HTML+Text לתזכורת תשלום נכשל.
- **`src/lib/utils.ts`** — `cn` (clsx+tailwind-merge), `formatCurrency`, `formatDate`/`formatDateCompact`/`formatDateTime`, `getStatusColor` (מיפוי status→Tailwind).
- **`src/lib/gam-auth.ts`** — אימות טוקן GAM (RS256) בלבד (לא מנפיק) — ראה סעיף 2.2.
- **`src/lib/stripe-client.ts`** — cache של Stripe.js instances לפי publishableKey; `fetchPublishableKey` (ללא fallback ל-env — per-account חובה).

---

## 14. סיכום זרימות מפתח (Quick Reference)

| תרחיש | מה קורה בפועל |
|---|---|
| חשבונית נכשלה (insufficient funds וכו') | נשארת `open`, `attempt_count` עולה, Stripe ממשיך לנסות לפי לוח הזמנים שלו (`next_payment_attempt`) עד שמישהו עוצר (Pause) או משלם. |
| לחיצה על "Retry" | חיוב **ישיר על אותה invoice** (`PATCH action:retry`), לא יוצר דבר חדש. |
| לחיצה על "Make Payment" → Schedule | יוצר **draft חדש** מתוזמן, **מבטל** (void) את כל ה-failed invoices שנבחרו, מעביר metadata אליו. |
| תשלום Pay-Now (אדמין) | PaymentIntent חדש + `distributePayment` (draft→מחיקה/קיזוז, open→ביטול/credit note) על החשבוניות שנבחרו/applyToAll. |
| תשלום Pay-Link (לקוח) | PaymentIntent חדש, **מונה Firestore בלבד** יורד — **לא נוגע בשום חשבונית אחרת**. |
| בחירת תוכנית תשלומים ב-`/pay` | תשלום #1 מיידי (pay-link רגיל) + #2..N דרך מנוע חיצוני (`createFutureInvoices`), אידמפוטנטי. |
| Void חשבונית | מבטל **רק** את זו שנבחרה, אופציונלי מוסיף קרדיט בגובה היתרה. |
| Refund | חלקי/מלא, מסמן `metadata.refunded='true'` על ה-PI (לא שדה Stripe אמיתי — ראה סעיף 11). |
| הוספת כרטיס | Stripe Elements → attach ל-customer, אופציונלי ברירת מחדל. |
| Screenshot/הוכחת תשלום | URL חתום-זמני מ-bucket חיצוני (`lec-records`), 5 דקות תוקף, לפי GUID במטא-דאטה. |
| סטייטמנט PDF | Magic בונה HTML → Gotenberg (פרטי, OIDC auth) ממיר ל-PDF → מצורף למייל (Gmail API / Nodemailer fallback). |

---

*מסמך זה נכתב מתוך סריקה מלאה של הקוד (כל ה-API routes, כל רכיבי ה-UI, כל ספריות ה-lib) ושל הזיכרון המתועד מסשנים קודמים. אם קוד משתנה — יש לעדכן מסמך זה בהתאם.*
