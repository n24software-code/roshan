# Event Restaurant Ordering Platform

A bilingual (English / Arabic) ordering site for a single event, plus an English-only
admin dashboard.

A guest browses restaurants, picks **one dish**, gives their name, email and Saudi
mobile number, verifies that number by SMS, and receives an order number to show at
the collection counter.

There are no payments, no delivery, no cart, and no customer login.

## The one rule everything is built around

> **One verified customer = one order per event.**

That rule is enforced by the database, not by the interface:

- `UNIQUE (event_id, customer_id)` on `orders`
- `UNIQUE (phone)` on `customers`, where the phone is always stored normalized to
  `+9665XXXXXXXX`, so `0551234567` and `+966551234567` are the same person
- a single `place_order()` function that performs every check and the insert in one
  transaction, so refreshing, a second tab, another device, incognito, a double-click
  or two simultaneous API calls all end at the same place: one order

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

| Variable | Where it runs | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | Public key (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Order creation. Bypasses RLS — never expose it |
| `NEXT_PUBLIC_APP_URL` | browser | Absolute app URL |

No Twilio credential belongs here. Twilio is configured inside Supabase (step 4).

### 3. Database

Open the Supabase SQL Editor and run **`supabase/setup.sql`** — one paste that contains
all migrations and the development seed.

Prefer running them individually? Apply in order:

```
supabase/migrations/0001_init.sql     tables, constraints, indexes
supabase/migrations/0002_functions.sql  place_order(), triggers, realtime
supabase/migrations/0003_rls.sql      row level security
supabase/seed.sql                     LEAP Riyadh demo data
```

`supabase/setup.sql` is generated — after editing a migration, regenerate it:

```bash
npm run db:bundle
```

### 4. SMS verification (Twilio via Supabase)

In the Supabase dashboard → **Authentication → Sign In / Providers → Phone**:

1. Enable **Phone**
2. Choose **Twilio** and enter the Account SID, Auth Token and Message Service SID
3. Set the OTP length to **6** and the expiry to **600** seconds
4. Leave "Confirm phone" enabled

Until this is configured, the OTP screen reports
*"SMS verification is not configured for this environment."*

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
notification triggers, and that RLS is enabled everywhere.

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
Name / email / Saudi mobile          server action: sendVerificationCode
        ↓                            → Supabase Auth → Twilio SMS
6-digit code
        ↓                            server action: verifyAndPlaceOrder
Supabase verifies the OTP            → session established, phone confirmed
        ↓
place_order() in one transaction     → re-reads event, restaurant, item and PRICE
        ↓                              from the database; refuses anything invalid
Order number (A-1048)                → returns 'created' or 'duplicate'
```

The client never sends a price. `place_order()` has no price parameter at all, so a
tampered request cannot express one. Restaurant and item ids are treated as lookup
keys and re-validated: the item must exist, be available, and belong to the chosen
restaurant, which must itself be active and taking part in the active event.

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
      verify/                 OTP screen
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
    i18n/                     translator, locale config
    data/                     read queries
  messages/{en,ar}.json
  proxy.ts                    locale routing + session refresh + admin gate
supabase/
  migrations/                 0001 schema · 0002 logic · 0003 RLS
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
