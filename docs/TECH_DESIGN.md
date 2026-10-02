# Technical Design — Cue & Rail Billiard System

> Status: **Accepted** (v1.0)
> Business rules: `docs/BUSINESS_DECISIONS.md`
> Product spec: `Project.md`
> Design system: `KITAB DESIGN_cuecraft billiard design system/cue_rail_system/DESIGN.md`

`Project.md` §82 deferred all technical architecture until the business workflow was
stable. The workflow is now stable — all nine open decisions are closed in
`BUSINESS_DECISIONS.md`. This document is the architecture that follows.

---

## 1. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 15 App Router, TypeScript strict | Server Components for read paths, route handlers for mutations. One deployable. |
| Database | PostgreSQL (Neon free tier) | Only engine where double-booking can be prevented by the database itself (§5). |
| ORM | Prisma 6 | Typed queries; the exclusion constraint is hand-written SQL, which is a known and small gap. |
| Auth | Auth.js v5 credentials, bcrypt | Staff-only in MVP. No OAuth, no magic links, no customer accounts. |
| Styling | Tailwind CSS v4, CSS-first `@theme` | Tokens come straight from `DESIGN.md` as CSS variables. |
| Storage | Local disk under `public/uploads/` | Payment proofs only. Object storage when a second instance needs them. |
| Tests | `node:test` + `node:assert` | Built in. No test framework dependency for a suite this size. |

**Explicitly not used:** Redis, BullMQ, Docker, a queue service, a cache. Each would be
a running process to operate for a single-venue MVP.

---

## 2. Architecture Shape

```
Customer (browser)
     │
     ▼
Next.js App Router
     ├── Server Components  → read availability, booking detail, admin dashboards
     ├── Route Handlers     → mutations, auth-gated
     └── Server Actions     → form submits from authenticated staff UI
                │
                ▼
         Domain logic (src/lib/)  ← pure, unit-tested, no DB
         availability.ts · pricing.ts
                │
                ▼
         Prisma → PostgreSQL
                │
                ▼
         notification_logs (outbox) → dispatched via after() → WhatsApp provider
```

Domain logic is kept free of database access so it can be tested without one. The
database is the authority for *conflicts*; the domain functions are the authority for
*calculations*.

---

## 3. Entity Map

`Project.md` §79 lists 16 entities. Eleven are built.

### Built

| Entity | Purpose | Key fields |
| --- | --- | --- |
| `User` | Staff login | `role`, `passwordHash` |
| `Table` | A billiard table | `code`, `type`, `status`, `sortOrder` |
| `OperatingHour` | One row per weekday | `weekday`, `opensAtMin`, `closesAtMin` |
| `PricingRule` | Hourly rate windows | `tableType`, `weekendOnly`, `startsAtMin`, `endsAtMin`, `hourlyPrice` |
| `Setting` | Policy key-value store | every CONFIGURABLE value in `BUSINESS_DECISIONS.md` |
| `Booking` | A reservation | `code`, `startAt`, `endAt`, `status`, `depositAmount`, `holdExpiresAt` |
| `Payment` | Deposit / extension / settlement | `kind`, `method`, `status`, `proofPath` |
| `Session` | Actual play | `startedAt`, `scheduledEndAt`, `extendedMinutes` |
| `Extension` | Additional time | `requestedMinutes`, `approvedMinutes`, `reason` |
| `NotificationLog` | WhatsApp outbox | `event`, `status`, `attempts` |
| `AuditLog` | Who did what | `actor`, `action`, `entity`, `before`, `after`, `reason` |

### Cut, and what replaces each

| Cut from §79 | Replacement | Add it back when |
| --- | --- | --- |
| `customers` | `bookings.customerName` + `customerPhone` | Customers need to log in, or staff need aggregate per-customer history |
| `notifications` | `notification_logs` — §32 already described a single entity | Never; split only if a channel needs its own delivery state |
| `booking_status_history` | `audit_logs` with `entity = 'booking'` — one timeline serves both §57 and §58 | Never |
| `payment_proofs` | `payments.proofPath` + `proofUploadedAt` | A booking needs more than one proof revision |
| `maintenance_periods` | `tables.status = MAINTENANCE` (persistent, per §54's T06) | Maintenance becomes scheduled/recurring rather than ad-hoc |
| `table_types` | `enum TableType { REGULAR VIP }` | A third type needs attributes beyond the enum |

**Added:** `Setting`. `Project.md` puts policy values in prose; putting them in a table
is what makes "owner can change policy without a deploy" true.

---

## 4. Domain State Machines

Enum definitions are verbatim from `Project.md` §59. The flow diagrams are §60 and §61.

### Booking (§60)

```
PENDING ──► AWAITING_DEPOSIT ──┬──► CONFIRMED ──► CHECKED_IN ──► COMPLETED
                              │         │             │
                              ├──► EXPIRED           ├──► (SESSION ACTIVE)
                              └──► CANCELLED         └──► (EXTENSION loop)

Any pre-COMPLETED state ──► NO_SHOW   (grace period elapsed)
Any pre-COMPLETED state ──► CANCELLED (customer or venue)
```

### Payment (§61)

```
PENDING ──┬── QRIS    ──► PROOF_SUBMITTED ──┬──► PAID
          │                                 └──► REJECTED ──► (re-upload)
          └── CASH   ──► (stays PENDING)    ──► PAID
PAID ──► REFUNDED    (D3: record only, no automatic transfer in MVP)
```

`WAITING CASH` from §61 is not a status. It is `status = PENDING` with
`method = CASH_AT_COUNTER`. Adding it as a status would duplicate the `method` field.

### Table (§8)

```
AVAILABLE ⇄ HELD ⇄ OCCUPIED
    │
    └──► MAINTENANCE   (staff-set, blocks booking entirely)
```

Table status is **derived**, not the source of truth. A table is OCCUPIED because a
`Session` is ACTIVE, and HELD because an unexpired `AWAITING_DEPOSIT` booking covers
now. Storing status separately invites it to drift from the bookings that justify it.

### Session (§35)

```
ACTIVE ──► ENDED
   └────► OVERDUE    (past scheduledEndAt + grace, still running)
```

---

## 5. Concurrency: Double-Booking Protection

This is the single most important correctness property in the system
(`Project.md` §64), and it is enforced **in the database**, not in application code.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
  ADD CONSTRAINT no_overlap EXCLUDE USING gist (
    table_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  )
  WHERE (status IN ('PENDING','AWAITING_DEPOSIT','CONFIRMED','CHECKED_IN'));
```

**Why this and not an application check.** `Project.md` §64 describes two customers
submitting simultaneously. An application-level `SELECT` then `INSERT` cannot prevent
it: both transactions read "free", both insert. This constraint makes the second
insert fail at commit time with SQLSTATE `23P01`, no matter how many app instances are
running or how the requests interleave.

**Why `btree_gist`.** The constraint needs two different operators — `=` on `table_id`
and `&&` on the time range — in one GiST index. Plain GiST does not support scalar
equality; `btree_gist` adds it.

**Why the `WHERE` clause.** Without it, a CANCELLED or EXPIRED booking would block its
slot forever. With it, terminal statuses drop out of the constraint automatically and
the freed slot needs no cleanup job.

**Why `tstzrange` and not two comparisons.** `(table_id = x) AND start_at < other.end AND end_at > other.start` is not expressible as a single GiST index entry, so it would degrade to a sequential scan with a filter — correct but not concurrent-safe at write time.

**Half-open ranges.** `tstzrange(start_at, end_at)` is `[start, end)`, matching
`Project.md` §63: a booking ending 22:00 and one starting 22:00 do not conflict.

**Application behaviour on `23P01`:** map to `409 Conflict` with the conflicting
window. The customer picks a different slot — not a different table silently, because
they chose a time.

---

## 6. Lazy Expiry — No Cron, No Worker

Neon's free tier **suspends compute after ~5 minutes idle**, and `pg_cron` stops with
it. A scheduled expiry job would therefore be unreliable in dev and would need a paid
tier plus an always-on worker in production.

Instead, hold expiry is computed **when data is read**:

```sql
UPDATE bookings
   SET status = 'EXPIRED'
 WHERE status = 'AWAITING_DEPOSIT'
   AND hold_expires_at < now()
   AND booking_code IN ( /* codes this request is about to return */ );
```

Swept at the entry point of every endpoint that returns availability, bookings, or
admin dashboards. A booking whose hold lapsed is marked EXPIRED the next time anyone
looks at it, which is exactly when it matters.

`bookings_awaiting_deposit_hold` — a partial index on `hold_expires_at WHERE status =
'AWAITING_DEPOSIT'` — keeps the sweep cheap.

**Trade-off, stated plainly:** if nobody ever requests availability, expired bookings
stay `AWAITING_DEPOSIT` in the database and appear in admin reports as stale. The
status is wrong in the row but the table is correctly free, because the availability
query excludes lapsed holds regardless of stored status. If this becomes visible in
production, add Vercel Cron calling the same sweep — the function already exists.

---

## 7. WhatsApp — Async Without a Queue

`Project.md` §31 and §66 require that a provider failure never blocks or rolls back a
payment or booking (§33). The requirement is real; a queue service is not.

```
POST /admin/api/payments/:id/confirm
     │
     ▼
BEGIN TRANSACTION
  update payments    → PAID
  update bookings    → CONFIRMED
  insert notification_logs (status = PENDING)   ← outbox row, same transaction
  insert audit_logs
COMMIT                          ← booking is durable regardless of WhatsApp
     │
     ▼  response returns to the admin
after(() => dispatchNotifications())            ← outside the transaction
     │
     ├── provider OK  → status = SENT, providerMessageId
     └── provider err → status = FAILED, errorMessage, attempts + 1
```

**Why the outbox row is written inside the transaction.** If the row were written
after commit, a crash between commit and write would silently lose the notification.
Written inside, the row survives any failure, and `status = PENDING` rows are
resendable by re-running dispatch.

**Why `after()` rather than a queue.** `after()` runs after the response is flushed, so
the admin UI never waits on the provider (§66), and it survives the request lifecycle.
For a single venue's notification volume it is sufficient. The `attempts` counter
exists so a retry loop can be added without a schema change.

**Delivery failure is recorded, never raised.** `Project.md` §33: WhatsApp is a
delivery mechanism, not a source of truth.

---

## 8. Idempotency

Two operations must survive a client retry without duplicating money or reservations.

| Operation | Key | Behaviour on replay |
| --- | --- | --- |
| Create booking | `bookings.idempotencyKey`, client-supplied UUID | Returns the existing booking, `200` instead of `201` |
| Confirm payment | Natural key: `paymentId` + `PAID` check | Already-paid returns the same result, never double-applies |
| Submit QRIS proof | `payments.proofPath` already set | Rejects with 409, forces a fresh upload |

Payment confirmation is naturally idempotent because the transition is
`PROOF_SUBMITTED → PAID`; a second attempt finds no `PROOF_SUBMITTED` row to act on.

---

## 9. API Contract

All handlers live in `src/app/api/`. Mutations are `POST`. Reads are `GET`.

### Public — customer, no authentication

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/availability?date&startMin&durationMin` | Tables free for a window (§10) with prices |
| `POST` | `/api/bookings` | Create booking + `AWAITING_DEPOSIT` (§13) |
| `GET` | `/api/bookings/:code?phone=` | Booking detail (§49). Phone required so a code alone is not a credential |
| `POST` | `/api/bookings/:code/proof` | Upload QRIS proof image (§19) |
| `GET` | `/api/bookings/:code/quote` | Max extension + allowed increments (§38–40) |
| `POST` | `/api/bookings/:code/cancel` | Cancel with party + reason (§52, D3) |

### Staff — Auth.js session required

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/tables` | Live table monitor (§54) |
| `POST` | `/api/admin/payments/:id/confirm` | Confirm deposit (§21, §24) |
| `POST` | `/api/admin/payments/:id/reject` | Reject with reason (§22) |
| `POST` | `/api/admin/bookings` | Manual booking (§47 walk-in) |
| `POST` | `/api/admin/bookings/:code/checkin` | Check-in, starts session (§34) |
| `POST` | `/api/admin/sessions/:id/end` | End session, compute overage (§53) |
| `POST` | `/api/admin/sessions/:id/extend` | Extension, re-checks availability (§41) |
| `POST` | `/api/admin/tables/:id/status` | Maintenance toggle (§8) |
| `POST` | `/api/admin/bookings/:code/no-show` | Mark no-show (§51) |

**Authorisation.** `OWNER` may change pricing, tables, and operating hours. `CASHIER`
may verify payments, check in, extend, and check out. Role is checked inside the
handler, not only in middleware — middleware guards routes, it is not the policy.

### Error shape

One shape everywhere, so the client never parses two:

```json
{ "error": { "code": "SLOT_TAKEN", "message": "...", "details": {} } }
```

`409 SLOT_TAKEN` is the only conflict a customer can trigger, and it always means
"someone else got there first".

---

## 10. Transaction Boundaries

| Operation | Must be atomic because |
| --- | --- |
| Create booking | Insert + payment row + notification + audit, or nothing (§65) |
| Confirm payment | `PAID` + `CONFIRMED` + outbox + audit (§65) |
| Check-in | `CHECKED_IN` + `OCCUPIED` + session row + audit |
| Extend | Extension row + payment + session end shift + booking end shift (§41) |
| Checkout | Overage + `FINAL` payment + `ENDED` + `COMPLETED` + `AVAILABLE` + audit |

Extension is the risky one: it mutates `bookings.endAt`, which the exclusion
constraint watches. The re-check and the update therefore happen in one transaction,
and a losing transaction rolls back cleanly rather than leaving a paid extension with
no extra time.

---

## 11. Money Handling

- **Integer rupiah, everywhere.** No floats, no decimal columns.
- All computation goes through `src/lib/pricing.ts`. Nothing in the UI computes a price.
- Deposit, rounding, and floor are one function (`depositAmount`) with tests.
- `remainingAmount` is recomputed server-side on every payment, never trusted from the
  client.
- Refund is a **record** in MVP (D3). Automatic transfer needs a gateway that does not
  exist yet.

---

## 12. Testing Strategy

The rule: non-trivial logic leaves exactly one runnable check behind. No framework, no
fixtures, no mocking.

`tests/domain.test.ts` covers the calculations where a silent bug costs money or a
double-booked table:

- half-open overlap and the §63 boundary cases
- buffer on both sides of a gap
- terminal statuses not blocking rebooking
- operating hours, including the midnight-crossing window (D9)
- extension ceilings: no next booking / 30-min gap / exact-touch (0) / closing boundary
- pricing split across a boundary window, pro-rata minutes, unpriced gaps surfaced
- deposit floor and round-up (D1)
- overage blocks past grace (D5)
- settlement balance never negative

`npm test` runs it. There is no integration test suite; the end-to-end scenario in the
verification pass is the manual substitute until a second venue or a real payment
provider makes one worth writing.

---

## 13. Screen Map

`KITAB DESIGN/` holds 16 Stitch screens. Route assignment:

| Route | Screen |
| --- | --- |
| `/` | customer_booking_venue_home |
| `/meja` | table_availability_floor_plan_reservation |
| `/meja/peta` | visual_floor_map_table_reservation (view toggle) |
| `/booking/[code]` | booking_checkout_deposit_hold |
| `/booking/[code]/lunas` | booking_confirmed_digital_keyless_pass |
| `/booking` | my_bookings_match_ledger |
| `/m/meja` | mobile_table_availability_instant_hold |
| `/m/booking/[code]` | mobile_keyless_pass_booking_dossier |
| `/admin` | venue_operations_floor_command |
| `/admin/meja` | table_operations_spatial_floor_command |
| `/admin/pembayaran` | deposit_verification_table_hold_status |
| `/admin/kasir` | cashier_booking_payment_command |
| `/admin/booking/[code]` | detailed_booking_record_staff_dossier |
| `/admin/sesi/[id]` | active_match_session_control |
| `/m/admin` | mobile_floor_ops_cashier_command |

Three architectural photographs and the monogram are venue assets, not screens.

---

## 14. Known Gaps

Stated rather than hidden.

| Gap | Consequence | Fix |
| --- | --- | --- |
| No migration rollback story | A bad migration must be fixed forward | Prisma `migrate resolve`; migrations are additive-only by policy |
| `Table.status` can drift from bookings | Admin override may desync the display | Admin status change writes an `audit_logs` row; a reconciliation view is not built |
| Refund is manual | Venue must remember to refund | Out of scope until a gateway exists (D3) |
| Expiry is lazy | Stale rows linger if nobody reads | Acceptable; add Vercel Cron on the same sweep function |
| Single venue | No `venue_id` anywhere | Adding it later touches every table and the exclusion constraint |
| No holiday calendar | Public holidays price as weekends | `weekendOnly` flag is the seam to extend |

---

## 15. Verification Before This Document Is Considered Done

1. `npm test` — all green.
2. `npm run typecheck` — no errors.
3. `npm run lint` — no errors.
4. `npx prisma migrate dev` against Neon — applies, including `btree_gist`.
5. Two concurrent inserts on the same table + window — exactly one succeeds, the other
   returns `23P01`. **This is the check that matters most and cannot be skipped.**
6. One full scenario in the browser: availability → booking → QRIS proof → admin verify →
   check-in → extension → checkout.