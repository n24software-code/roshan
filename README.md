# Event Restaurant Ordering Platform

A bilingual (English / Arabic) ordering site for a single event, plus an English-only
admin dashboard.

A guest browses restaurants, picks **one dish**, gives their name and Saudi mobile
number, proves the number is theirs by sending a WhatsApp message, and receives an
order number to show at the collection counter.

There is no attendee list, no registration, no password, no email, no payments, no
delivery, no cart and no customer login.

## The one rule everything is built around

> **One verified phone number = one order per event.**

That rule is enforced by the database, not by the interface:

- `UNIQUE (event_id, customer_phone)` on `orders`, where `customer_phone` is filled by
  a trigger so every insertion path is covered
- `UNIQUE (event_id, customer_id)` on `orders` and `UNIQUE (phone)` on `customers`
- every phone is stored normalized to `+9665XXXXXXXX`, so `0551234567`,
  `966551234567` and `+966551234567` are the same person
- a single `place_verified_order()` function that performs every check and the insert
  in one transaction, so refreshing, a second tab, another device, incognito, a
  double-click or two simultaneous API calls all end at the same place: one order

Uniqueness is scoped to the event, so the same number may order again at a different
event.

A guest who tries again is shown their existing order, and the attempt is recorded in
`admin_audit_logs` so staff can see it on the Customers page.

---

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Supabase
(PostgreSQL, Auth, Realtime) · Zod · Vitest

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

Copy `.env.example` to `.env.local` and fill it in:

| Variable                               | Where it runs    | Purpose                                         |
| -------------------------------------- | ---------------- | ----------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | browser + server | Project URL                                     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | Public key (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY`            | **server only**  | Verification + order creation. Bypasses RLS     |
| `NEXT_PUBLIC_APP_URL`                  | browser          | Absolute app URL                                |
| `PHONE_VERIFICATION_SECRET`            | **server only**  | HMAC key for one-time codes. Required in prod   |
| `VERIFICATION_PROVIDER`                | **server only**  | `whatsapp_cloud` (default) or `dev` (local)     |
| `WHATSAPP_BUSINESS_NUMBER`             | **server only**  | Number attendees message, digits only           |
| `WHATSAPP_APP_SECRET`                  | **server only**  | Verifies the webhook signature                  |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN`        | **server only**  | Echoed back on Meta's webhook handshake         |

Locally, `VERIFICATION_PROVIDER=dev` is enough — see step 4.

### 3. Database

Open the Supabase SQL Editor and run **`supabase/setup.sql`** — one paste that contains
all migrations and the development seed.

Prefer running them individually? Apply in order:

```
supabase/migrations/0001_init.sql       tables, constraints, indexes
supabase/migrations/0002_functions.sql  place_order(), triggers, realtime
supabase/migrations/0003_rls.sql        row level security
supabase/migrations/0004_storage.sql    image bucket + storage policies
supabase/migrations/0005_phone_verification.sql
                                        phone_verifications, one-order-per-phone
                                        constraint, verification RPCs
supabase/seed.sql                       LEAP Riyadh demo data
```

`supabase/setup.sql` is generated — after editing a migration, regenerate it:

```bash
npm run db:bundle
```

### 4. WhatsApp verification

**Locally** nothing external is needed. Set `VERIFICATION_PROVIDER=dev` and the verify
screen offers a **Simulate WhatsApp message** button that replays the message through
the real webhook, so the whole path — request, code, webhook, verified session — is
exercised without a WhatsApp account. The `dev` provider refuses to load when
`NODE_ENV=production`.

**In production**, create a Meta WhatsApp Business app
(<https://developers.facebook.com> → WhatsApp → API Setup):

1. Note the business phone number attendees will message → `WHATSAPP_BUSINESS_NUMBER`
   (digits only, with country code)
2. App settings → Basic → **App secret** → `WHATSAPP_APP_SECRET`
3. WhatsApp → Configuration → **Webhook**
   - Callback URL: `https://your-domain.example/api/verification/whatsapp`
   - Verify token: any string you choose → `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - Subscribe to the **`messages`** field
4. Set `VERIFICATION_PROVIDER=whatsapp_cloud` and a
   `PHONE_VERIFICATION_SECRET` (`openssl rand -base64 32`)

Until those are set the verification screen reports
_"WhatsApp verification is not configured for this environment."_ and no order can be
placed — production never accepts an unverified number.

### 5. Create an admin

There is deliberately no admin sign-up page — the `admin` role can only be granted
server-side:

```bash
npm run create-admin admin@example.com 'a-strong-password'
```

Then sign in at `/admin/login`.

### 6. Run

```bash
npm run dev
```

- Storefront: <http://localhost:3000> (redirects to `/en` or `/ar`)
- Admin: <http://localhost:3000/admin>

---

## Verifying it works

```bash
npm test              # unit tests (phone, validation, transitions, i18n, search)
npm run verify:schema # runs the SQL against an in-process Postgres and asserts the business rules
npm run lint
npm run build
```

`npm run verify:schema` needs no database: it boots Postgres in WASM (PGlite), applies
the migrations and the seed, then checks the one-order rule, price authority, the
disabled-restaurant and unavailable-item paths, every constraint, the history and
notification triggers, the whole verification lifecycle (rate limiting, wrong codes,
attempt limits, replay, expiry, cross-event reuse) and that RLS is enabled everywhere.

The integration suite in `tests/integration/` runs the same rules against a real
Supabase project — including true concurrent submissions and RLS as an anonymous
visitor. It skips unless a service-role key is present:

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm test
```

---

## How an order is created

```
Guest picks restaurant + item        (client, stored locally)
        ↓
Name + Saudi mobile                  server action: startPhoneVerification
        ↓                            → request_phone_verification()
                                       stores an HMAC of a one-time code and a
                                       SHA-256 of the session token; the browser
                                       gets the token in an httpOnly cookie
        ↓
"Verify via WhatsApp"                opens wa.me with the message prefilled.
        ↓                            Clicking it verifies nothing.
Guest sends the message
        ↓
POST /api/verification/whatsapp      signature checked, sender read from the
        ↓                            provider payload, not the message body
confirm_phone_verification()         → matches sender + code, marks the row
        ↓                              verified and destroys the code hash
Screen polls and continues           server action: submitVerifiedOrder
        ↓
place_verified_order()               → identity comes from the verification row;
  in one transaction                   re-reads event, restaurant, item and PRICE
        ↓                              from the database; refuses anything invalid
Order number (A-1048)                → returns 'created' or 'duplicate'
```

Ownership of the number is established by the _sender_ the provider reports. The code
in the message body only says which request is being answered, it is stored as an
HMAC, it expires after 10 minutes, it survives five wrong attempts at most, and it is
destroyed the moment it is used — so it can never be replayed.

The client never sends a price. `place_order()` has no price parameter at all, so a
tampered request cannot express one. Restaurant and item ids are treated as lookup
keys and re-validated: the item must exist, be available, and belong to the chosen
restaurant, which must itself be active and taking part in the active event.

---

## Images

Admins upload image files in the dashboard — there is no image-URL field. Files
go to `POST /api/admin/images`, which authorizes the caller, re-validates the
file and writes to the `menu-images` Supabase Storage bucket. The service-role
key stays on the server; the browser only ever posts a file.

Keys look like `restaurants/<id>/<uuid>.jpg`, so an original filename can never
influence the stored path and two uploads can never collide.

The image columns hold a reference, resolved by `resolveImageUrl()`:

| Stored value                  | Meaning                               |
| ----------------------------- | ------------------------------------- |
| `restaurants/<id>/<uuid>.jpg` | object in the bucket (uploads)        |
| `/menu/kfc-logo.jpg`          | file shipped in `public/` (seed data) |
| `https://…`                   | URL stored before uploads existed     |

All three keep working, so no data migration was needed. Missing images render a
styled placeholder rather than a broken icon.

Uploads are restricted three ways: extension, declared MIME type, and the file's
actual magic bytes — so an SVG renamed to `.jpg` with a spoofed content type is
rejected. The bucket itself also enforces a 5 MB cap and the JPEG/PNG/WebP
allow-list, and storage RLS blocks any non-admin write.

---

## Security

- Row Level Security on every table. The public catalogue is readable by anyone;
  `phone_verifications` is readable by admins only and by nobody else; everything else
  is admin-only.
- Customers can never insert or update an order. Creation goes through
  `place_verified_order()`, which — like every verification function — is granted to
  `service_role` only and revoked from `anon` and `authenticated`.
- The verification cookie is an opaque lookup key with no phone number, status or
  signature in it. Forging, copying or clearing it cannot produce a verified state the
  database does not already hold; the cookie is UX, the row is the boundary.
- A code verified for one event cannot place an order in another: the event is on the
  verification row and is compared with the event being ordered in.
- Verification requests are rate limited per number (a 30-second cooldown and five
  requests per hour) and codes expire after 10 minutes.
- Admin access requires a row in `user_roles`. It is checked in the proxy
  (`src/proxy.ts`) **and** again server-side on every admin page and mutation
  (`requireAdmin`), so a hidden route is never the only defence.
- The service-role key is read through a `server-only` module and is never bundled
  for the browser.
- Order numbers are short and human-readable (`A-1048`); database UUIDs are never
  shown to guests. Because reading an order still requires the guest's own session,
  guessing an order number reveals nothing.

---

## Project structure

```
src/
  app/
    (site)/[locale]/          storefront — English + Arabic, RTL aware
      page.tsx                event landing + restaurant list
      restaurants/[slug]/     menu, search, single-item selection
      order/                  selection review + attendee details
      verify/                 WhatsApp verification screen
      confirmation/[orderNumber]/  confirmation + live status
    (admin)/admin/            dashboard — English only, LTR
      login/
      (dashboard)/            dashboard, orders, restaurants, menu,
                              customers, events, notifications, reports, settings
    api/admin/reports/export/ CSV export
    api/verification/whatsapp/ inbound WhatsApp webhook
  components/{customer,admin,ui}/
  lib/
    supabase/                 browser / server / service-role / proxy clients
    auth/                     admin authorization + sign-in
    validation/               shared Zod schemas
    orders/                   order server actions + error codes
    verification/             codes, message, session cookie, service,
                              server actions, swappable providers/
    admin/                    admin mutations + status transitions
    phone/                    Saudi number normalization
    i18n/                     translator, locale config
    data/                     read queries
  messages/{en,ar}.json
  proxy.ts                    locale routing + session refresh + admin gate
supabase/
  migrations/                 0001 schema · 0002 logic · 0003 RLS
                              0004 storage · 0005 phone verification
  seed.sql                    LEAP Riyadh demo data
  setup.sql                   generated: all of the above in one paste
scripts/
  create-admin.mjs            grant the admin role
  verify-schema.mjs           run the SQL and assert the business rules
  bundle-sql.mjs              regenerate setup.sql
tests/
```

---

## Order lifecycle

```
NEW → ACCEPTED → PREPARING → READY → COMPLETED
 └────────┴──────────┴─────────┴──→ CANCELLED
```

Completed and cancelled are terminal. Every change is appended to
`order_status_history`, and cancelled orders stay in history and in reports.

Disabling a restaurant blocks **new** orders only — orders already placed continue to
be managed normally.

---

## Notes

- Reports show **order value**, never "revenue" — the platform takes no payments.
- Arabic search tolerates hamza, alef and ta-marbuta variants, so "كبسه" finds "كبسة".
- Realtime powers both the admin new-order toast and the guest's live order status.
