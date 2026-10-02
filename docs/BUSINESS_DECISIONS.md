# Business Decisions — Closure of Project.md Section 74

> Status: **Accepted** (v1.0, MVP)
> Source: `Project.md` §74 "Open Business Decisions" + §75 "Recommended Initial Operational Policy"
> Date: 2026-10-02

`Project.md` §74 lists nine unresolved business decisions. This document closes all
nine with concrete values for MVP. These supersede the "example" numbers scattered
throughout `Project.md`.

**Status vocabulary used here:**

| Label | Meaning |
| --- | --- |
| **LOCKED** | Won't change during MVP. Change = migration + code change. |
| **CONFIGURABLE** | Stored in DB (`settings` / `pricing_rules` / `operating_hours`), changeable by owner without deploy. |
| **PROVISIONAL** | Safe for prototype, revisit after real data. |

---

## D1 — Deposit

**Decision:** 30% of total booking price. Minimum Rp25.000. Rounded **up** to the
nearest Rp1.000. VIP uses the same 30% rate.

**Status:** **CONFIGURABLE** — `settings.deposit_percent`, `settings.deposit_min_idr`,
`settings.deposit_rounding_idr`.

**Rationale:**

- 30% is high enough that a no-show or walk-away is covered by DP, low enough that
  customers are not blocked from booking a cheap off-peak slot.
- Minimum floor exists because a 1-hour off-peak regular slot at Rp40.000 would
  otherwise require a Rp12.000 DP — too small to be worth the cashier's verification
  time.
- Rounding **up** protects the venue (never receives less than 30% after rounding).
- Same rate for VIP keeps one code path. Differentiated DP is a revenue lever worth
  pulling only when there is data showing VIP no-show rates differ.

**Worked examples:**

| Table | Duration | Gross | Deposit |
| --- | --- | --- | --- |
| Regular, weekday 10:00–17:00 | 2h | Rp80.000 | Rp24.000 → **Rp25.000** (min) |
| Regular, weekday 17:00–00:00 | 2h | Rp100.000 | Rp30.000 |
| Regular, weekend | 2h | Rp120.000 | Rp36.000 |
| VIP, weekday | 2h | Rp120.000 | Rp36.000 |
| Regular, +1h extension | 1h | Rp50.000 | Rp15.000 → **Rp25.000** (min) |

---

## D2 — Hold Duration

**Decision:** 15 minutes from booking creation.

**Status:** **CONFIGURABLE** — `settings.hold_duration_minutes`.

**Rationale:** Matches `Project.md` §75. Long enough for a QRIS scan plus screenshot,
short enough that a table isn't blocked by someone who abandoned the flow. Expired
holds free the table automatically — see `TECH_DESIGN.md` "Lazy Expiry".

---

## D3 — Cancellation Policy

**Decision:**

| Situation | Deposit |
| --- | --- |
| Customer cancels **> 2 hours** before `start_at` | Refunded 100% |
| Customer cancels **< 2 hours** before `start_at` | Forfeited |
| **No-show** (past grace period) | Forfeited |
| **Venue** cancels (maintenance, venue-caused) | Refunded 100% + goodwill code |

The 2-hour window is measured from the *booking* start time, not from now.

**Status:** **LOCKED** for MVP.

**Rationale:**

- Refunding a 2-hour-out cancellation costs the venue nothing — the table was almost
  certainly sellable again. Forfeiting it is pure friction that pushes customers to
  walk-in instead, which loses the transaction entirely.
- Inside 2 hours the table cannot realistically be resold, so the DP is the venue's
  compensation for lost inventory. This is the standard hospitality position.
- Venue-caused cancellation is separated from customer-caused because it inverts who
  is at fault. A single "cancel" action cannot correctly handle both, so
  `cancellation_party` is a required input.

**Refund mechanics (MVP):** refund is a **record, not a transfer**. `payments.status`
moves to `REFUNDED` and the amount is logged to `audit_logs`. Actual cash-out or
QRIS reversal is done manually by an admin and recorded with a `payment_proofs`-free
note. Automated refund transfer is out of scope (see `Project.md` §70) — it needs a
payment gateway that does not exist yet.

---

## D4 — Late Arrival

**Decision:** Session `started_at` = actual check-in time. Session `scheduled_end_at`
**stays anchored** to `booking.end_at`. The customer loses the lateness.

**Status:** **LOCKED** for MVP.

**Rationale:** The customer paid for a specific window of table time. Letting a late
arrival push `scheduled_end_at` forward would let a 20-minute-late customer walk out
of a free 20-minute extension, and would silently eat the buffer that protects the
next booking. Anchoring the end time also makes overage billing (§D5) fall out
naturally: a late arrival produces *underage*, not overage.

**Consequence:** no grace period is granted for late arrival in MVP. Coming 20 minutes
late to a 20:00–22:00 slot gives a 20:07–22:00 session. The customer can request an
extension if the next booking allows it (`Project.md` §38–40).

---

## D5 — Grace Period (Overrun)

**Decision:** 15 minutes free after `scheduled_end_at`. Overage is charged **only
past** that, rounded **up** to the nearest 15 minutes, at the table's prevailing rate.

**Status:** **CONFIGURABLE** — `settings.grace_minutes`, `settings.overage_increment_minutes`.

**Rationale:** A hard cutoff at `scheduled_end_at` forces arguments at the table
about whether the last shot counts. 15 minutes covers a fair finish plus a walk to
the counter. Charging per 15-minute block (not per started hour) matches how the venue
actually bills a quick overrun, and avoids a 16-minute overrun costing a full hour.

**Worked example:** session ends 22:20, `scheduled_end_at` 22:00, rate Rp50.000/h →
grace covers 22:00–22:15, overage = 22:15–22:20 rounded up to 15 min → **Rp12.500**.

---

## D6 — Buffer Time

**Decision:** 10 minutes global, inserted between every session and the next
reservation on the same table.

**Status:** **CONFIGURABLE** — `settings.buffer_minutes`.

**Rationale:** Matches `Project.md` §75. 10 minutes covers rail wiping, coin return,
and a handover conversation. Applied as an exclusion gap in the availability query,
not stored per-booking, so changing the value immediately changes future availability
without touching existing rows.

> **Ponytail note:** one global value. Per-table or per-zone buffers are not built
> until a venue actually asks — one venue, one floor.

---

## D7 — Extension

**Decision:**

- Allowed increments: **15, 30, 60 minutes**. Maximum single extension: **60 minutes**.
- Must be paid **immediately** before the extension is applied.
- Availability is re-checked at **submit** time, not just when the screen opens
  (`Project.md` §41).
- If the next booking blocks the extension, customer sees the **maximum** allowed
  duration instead of the full increment list (`Project.md` §39).
- Admin may override a blocking next-booking, but only with a recorded reason, and the
  displaced booking is **never moved automatically** (`Project.md` §44–45).

**Status:** **LOCKED** for MVP.

**Rationale:**

- Paying first means extension uses the same payment verification path as a deposit —
  one code path, not two.
- Re-check at submit is the only point where the answer can be trusted. Checking on
  screen-open is a hint, not a guarantee.
- "Show the max, don't hide the option" (§39) is better UX than offering `+1 hour`
  and failing at submit.

---

## D8 — Payment Method & Proof

**Decision:** Static QRIS + manual verification is the only online path. Cash at
counter is the offline path. Payment proof is **mandatory** for QRIS.

**Status:** **LOCKED** for MVP.

**Rationale:** Matches `Project.md` §19–24 and §72. Dynamic QRIS with webhook
confirmation requires a payment gateway; the upstream upgrade path is documented in
`Project.md` §72 and is out of MVP scope.

**Proof file rules:** image only (`jpeg`, `png`, `webp`), max 5 MB, stored under
`public/uploads/proof/{booking_code}/`. Filename is server-generated — never trust
the client filename.

---

## D9 — Operating Hours

**Decision:** **10:00–02:00** daily. The window crosses midnight, so a 23:30 booking
ending 01:30 is valid and must be evaluated as spanning two calendar dates.

**Status:** **CONFIGURABLE** — `operating_hours` table, one row per weekday.

**Rationale:** Billiard venues are evening businesses; 10:00 is a plausible morning
opening for regulars, 02:00 is a plausible close. Crossing midnight is the norm, not
the exception, so the availability engine must handle it correctly rather than
treating it as an edge case.

**Midnight handling rule:** a booking is stored as absolute `timestamptz`. Midnight is
never special-cased — `23:30 → 01:30` is just a 2-hour range that happens to cross a
date boundary. Availability comparison is interval-based, so no special logic is
needed. Operating-hours validation resolves the end time by adding hours and wrapping
past 24:00 when it overflows the closing hour.

---

## Settings Reference

Every value above marked CONFIGURABLE lives in a single `settings` key-value table
rather than scattered constants, so the owner can change policy without a deploy.

| Key | Default | Decision |
| --- | --- | --- |
| `deposit_percent` | `30` | D1 |
| `deposit_min_idr` | `25000` | D1 |
| `deposit_rounding_idr` | `1000` | D1 |
| `hold_duration_minutes` | `15` | D2 |
| `grace_minutes` | `15` | D5 |
| `overage_increment_minutes` | `15` | D5 |
| `buffer_minutes` | `10` | D6 |
| `cancel_free_until_hours` | `2` | D3 |
| `no_show_grace_minutes` | `15` | D3, `Project.md` §51 |
| `extension_increments_minutes` | `[15,30,60]` | D7 |
| `extension_max_minutes` | `60` | D7 |
| `venue_name` | `Cue & Rail Club` | — |
| `qris_static_payload` | — | D8, set per venue |

---

## What Is Deliberately Not Built

From `Project.md` §70 — confirmed out of MVP:

Membership · Loyalty points · Promo engine · F&B ordering · Advanced POS ·
Multi-branch · Customer rating · Referral · Subscription · Advanced analytics ·
Automated marketing · Dynamic QRIS / payment gateway

Also not built, and why:

| Not built | Add when |
| --- | --- |
| Automated refund transfer | A payment gateway exists (D3, D8) |
| Per-table / per-zone buffer | A second floor or zone is configured |
| Differentiated VIP deposit rate | VIP no-show data justifies it |
| Scheduled maintenance windows | Maintenance becomes recurring, not ad-hoc |
| WhatsApp retry scheduler | The provider reports transient failures at volume |
| Customer accounts / login | Booking history by phone + code stops being good enough |