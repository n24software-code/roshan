# Event Restaurant Ordering Platform

A bilingual (English / Arabic) ordering site for a single event, plus an English-only
admin dashboard.

A guest browses restaurants, picks **one dish**, gives their name, email and Saudi
mobile number, and receives an order number to show at the collection counter.

There are no payments, no delivery, no cart, no customer login, and **no phone
verification** — no SMS, no WhatsApp, no one-time code. The phone number and the
email address exist so the database can tell one guest from another.

## The one rule everything is built around

> **One event + one phone number = one order.**
> **One event + one email address = one order.**

That rule is enforced by the database, not by the interface:

- `UNIQUE (event_id, normalized_phone)` on `orders`
- `UNIQUE (event_id, normalized_email)` on `orders`
- `UNIQUE (event_id, customer_id)` on `orders`
- both normalized values are `NOT NULL` and re-normalized by a trigger on every
  write, so `0551234567`, `+966551234567` and `966551234567` are one person, and
  `Ahmed@GMAIL.COM` and `ahmed@gmail.com` are one person
- a single `place_order()` function that performs every check and the insert in one
  transaction, so refreshing, a second tab, another device, incognito, a double-click
  or two simultaneous API calls all end at the same place: one order

The restriction is per event: the same guest may order again at a different event.

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
| `SUPABASE_SERVICE_ROLE_KEY`            | **server only**  | Order creation. Bypasses RLS — never expose it  |
| `NEXT_PUBLIC_APP_URL`                  | browser          | Absolute app URL                                |

That is the whole list. No SMS, WhatsApp or verification provider credential is
required — the application does not talk to one.

### 3. Database

Open the Supabase SQL Editor and run **`supabase/setup.sql`** — one paste that contains
all migrations and the development seed.

Prefer running them individually? Apply in order:

```
supabase/migrations/0001_init.sql       tables, constraints, indexes
supabase/migrations/0002_functions.sql  place_order(), triggers, realtime
supabase/migrations/0003_rls.sql        row level security
supabase/migrations/0004_storage.sql    image bucket + storage policies
supabase/migrations/0005_remove_phone_verification_add_event_identity.sql
                                        per-event phone/email identity, no verification
supabase/seed.sql                       LEAP Riyadh demo data
```

`0005` is safe to run on a populated database: it backfills the new columns from the
existing customer rows and, if any historical orders would violate the new unique
indexes, it aborts and prints the exact conflicting orders rather than deleting them.

`supabase/setup.sql` is generated — after editing a migration, regenerate it:

```bash
npm run db:bundle
```

### 4. Anonymous sign-ins

In the Supabase dashboard → **Authentication → Sign In / Providers**, enable
**Anonymous sign-ins**.

Every guest is given an anonymous Supabase session the moment they open the event.
They never see a login or registration screen and never enter a code; the session
exists so row level security can let them — and only them — read their own order
back. It is _not_ the duplicate rule, which is keyed on phone and email.

The **Phone** provider can be turned off: nothing sends an SMS any more.

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
npm test              # unit tests + the duplicate-order rules against a real Postgres
npm run verify:schema # runs the SQL against an in-process Postgres and asserts the business rules
npm run lint
npm run build
```

Neither needs a database or any credentials: both boot Postgres in WASM (PGlite) and
apply the real migrations.

`tests/db/duplicate-orders.test.ts` runs the rule table end to end — first order
succeeds; same phone with a different email is refused; same email with a different
phone is refused; every accepted Saudi phone format and every email casing collapses
to the same person; the same guest may order again at another event; and an insert
that skips the pre-check is still stopped by the unique index.

`npm run verify:schema` additionally checks price authority, the disabled-restaurant
and unavailable-item paths, every constraint, the normalization functions, the history
and notification triggers, and that RLS is enabled everywhere.

The integration suite in `tests/integration/` runs the same rules against a real
Supabase project — including true concurrent submissions and RLS as an anonymous
visitor. It skips unless a service-role key is present:

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm test
```

---

## How an order is created

```
Guest opens the event                → anonymous Supabase session + device id
        ↓                              (localStorage: roshn_event_device_id)
Guest picks restaurant + item        (client, stored locally)
        ↓
Name / email / Saudi mobile          server action: placeOrder
        ↓                            → reads auth.uid() from the session; the
        ↓                              client never asserts who it is
place_order() in one transaction     → normalizes phone + email, re-reads event,
        ↓                              restaurant, item and PRICE from the database,
        ↓                              refuses anything invalid
        ↓                            → UNIQUE (event_id, normalized_phone) and
        ↓                              UNIQUE (event_id, normalized_email) decide
Order number (A-1048)                → returns 'created' or 'duplicate'
```

A guest who already has an order for this event is shown that order, never a second
one, and the attempt is recorded in `admin_audit_logs`. The message says only
_"You have already placed an order for this event."_ — it never reveals whether the
phone or the email was the match.

The device id is a secondary signal for staff only. It is stored on the order and
never blocks anything on its own.

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

- Row Level Security on every table. The public catalogue is readable by anyone; a
  guest can read only their own customer row and their own order; everything else is
  admin-only.
- Customers can never insert or update an order. Creation goes through
  `place_order()`, which is granted to `service_role` only and revoked from `anon` and
  `authenticated`.
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
      order/                  selection review + customer details
      confirmation/[orderNumber]/  confirmation + live status
    (admin)/admin/            dashboard — English only, LTR
      login/
      (dashboard)/            dashboard, orders, restaurants, menu,
                              customers, events, notifications, reports, settings
    api/admin/reports/export/ CSV export
  components/{customer,admin,ui}/
  lib/
    supabase/                 browser / server / service-role / proxy clients
    auth/                     admin authorization + sign-in
    validation/               shared Zod schemas
    orders/                   order server actions + error codes
    admin/                    admin mutations + status transitions
    phone/                    Saudi number normalization
    email/                    email normalization
    device.ts                 persistent browser id (roshn_event_device_id)
    auth/anonymous.ts         anonymous Supabase session
    i18n/                     translator, locale config
    data/                     read queries
  messages/{en,ar}.json
  proxy.ts                    locale routing + session refresh + admin gate
supabase/
  migrations/                 0001 schema · 0002 logic · 0003 RLS ·
                              0004 storage · 0005 per-event identity
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
