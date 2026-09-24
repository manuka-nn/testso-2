# Seamline — business operations platform

Sales, quotes, orders, manufacturing, inventory, purchasing, customers, finance and profit for Seamline — plus customer-facing pages: live order tracking links, quote approval links, a customer portal and a public quote request form.

The system starts **empty**. The first person to open it creates the workspace and becomes the admin.

**Demo walkthrough with screenshots:** open `docs/demo-guide.html`.

---

## 1. Run it (VS Code Live Server)

1. Unzip the folder and open it in VS Code.
2. Install the **Live Server** extension (Ritwick Dey).
3. Right-click `index.html` → **Open with Live Server**.
4. Create your workspace (company, your name, email, password).

No build step and no npm install. Everything the app needs (PDF, QR and Supabase libraries) is in `vendor/`.

| Page | What it is |
|---|---|
| `index.html` | Staff app |
| `track.html?t=…` | Customer's live order tracking (link from each order) |
| `track.html?q=…` | Customer's quote — view, download PDF, approve / decline / request changes |
| `quote-request.html` | Public quote request form (website, Instagram bio, WhatsApp profile) |
| `portal.html` | Customer portal |
| `docs/demo-guide.html` | Step-by-step demo |

## 2. Local mode vs Cloud mode

`js/config.js` decides:

- **Local mode** (both Supabase values empty — the default): data is stored in this browser. Good for trying it out. Customer links only open in the same browser.
- **Cloud mode** (Supabase URL + anon key filled in): data lives in Supabase, several staff can work at once and see each other's changes live, and customer links work on any phone.

## 3. Connect Supabase

1. Create a free project at <https://supabase.com>.
2. **SQL editor → New query** → paste all of `supabase/schema.sql` → **Run**.
3. **Project settings → API**: copy the **Project URL** and the **anon public** key into `js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```
   The anon key is designed to be public. Security comes from the row-level security rules in the schema — never put the `service_role` key in this app.
4. **Authentication → Providers → Email**: for the simplest setup turn **Confirm email** off. If you leave it on, every new login (staff or customer) must click the confirmation email before signing in.
5. **Authentication → URL configuration**: set the Site URL to your hosted address (so password-reset emails link back correctly).
6. Reload the app. The first person to sign up becomes the **admin**. Nobody else can become admin after that.

Moving from local to cloud: in local mode use **Settings → Data → Export backup**, connect Supabase, sign in, then **Import backup**.

### Put it online
Live Server only runs on your computer (`127.0.0.1`), so customers can't open those links. Host the folder on any static host — Netlify (drag and drop the folder), Vercel, GitHub Pages or Cloudflare Pages — and set:
```js
export const PUBLIC_BASE_URL = 'https://your-domain.com/';
```
Tracking links, quote links and QR codes then use that address.

## 4. Team and customers

- **Staff:** Settings → Users & roles → Add user. Roles: Admin, Sales, Operations, Finance. In cloud mode this creates their login; share the temporary password. Deactivating a user blocks access immediately. Users change their own password under Settings → Cloud, or with "Forgot password".
- **Customer portal:** open a customer → Portal access. In cloud mode this creates their login; "Send password reset" emails them a link. Customers only ever see their own orders, quotes, invoices and payments — never costs, margins or internal notes.

## 5. Sending things to customers

- **Quote:** open the quote → Send quote → Copy link / WhatsApp / Email. **Download PDF** (or **Share PDF** on phones) gives you the branded quotation. The customer's link also has a PDF download and Approve / Request changes / Decline buttons; their answer appears in Seamline automatically.
- **Invoice:** confirmed orders have **Invoice PDF**. Invoices list → PDF for any invoice. Bank details from Settings are printed on it.
- **Live tracking link:** every confirmed order has one secure link (plus QR code). Send it once. Status changes, payments and every update posted with "Show on the customer's live tracking link" ticked appear on it automatically — the page refreshes itself. "New link" replaces it; "Revoke" disables it.

## 6. How it works (short)

- Business rules are in `js/services.js`. Stock is a ledger: available = physical − reserved. Confirming an order reserves ready stock, dispatching deducts it, cancelling releases it. Made-to-order items never touch finished stock.
- Receiving purchase orders updates cost (weighted average), so profit uses real costs.
- Records are never deleted — they are cancelled, voided or archived, and every change is in the audit log.
- Customers never read the internal database. After each save the staff app publishes small customer-safe documents (`js/publisher.js` → `public_docs` table). Customers send requests back through an inbox (`inbox` table) that the staff app applies. That is why the staff app must be open (by anyone) for customer approvals and requests to be processed — they wait safely in the inbox until then.

| File | Purpose |
|---|---|
| `js/config.js` | Supabase and public address settings |
| `js/db.js` | In-memory data, local storage, numbering |
| `js/cloud.js` | Supabase sync, realtime, auth, inbox |
| `js/publisher.js` | Customer-safe documents and inbox processing |
| `js/services.js` | All business rules |
| `js/pdf.js` | Quote and invoice PDFs |
| `js/views-*.js` | Staff screens |
| `js/track.js`, `js/portal.js`, `js/request.js` | Customer pages |
| `supabase/schema.sql` | Tables, security rules, functions |

## 7. Good to know

- **Backups:** Settings → Data → Export backup (JSON). Supabase also has its own backups on paid plans.
- **Numbering:** order/quote/invoice numbers come from a shared counter. If two people create a document in the same second there is a small chance of a duplicate number; it is merged on the next sync and is easy to spot in the lists.
- **Images:** product photos and designs are compressed and stored with the data. Keep them to a sensible number per product.
- **Quote request form:** it's public, so spam is possible. If it becomes a problem, add Supabase rate limiting or a captcha in front of `submit_inbox`.
- **Fonts:** Inter loads from Google Fonts; without internet the system font is used.
