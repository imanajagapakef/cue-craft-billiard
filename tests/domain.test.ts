/**
 * Run: npm test
 *
 * Covers the money path — overlap, buffer, midnight crossing, extension
 * ceilings, deposit, and overage. These are the calculations where a silent
 * bug means either a double-booked table or money lost.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  allowedExtensionIncrements,
  bookingCodeFromSeq,
  conflictsWith,
  durationMinutes,
  endFromDuration,
  isTableFree,
  localMinutes,
  maxExtensionMinutes,
  minutesToClose,
  overlaps,
  withinOperatingHours,
  type OperatingWindow,
  type Reservation,
} from "../src/lib/availability.ts";

import {
  depositAmount,
  overageCharge,
  priceRange,
  settleableBalance,
  type PricingRule,
} from "../src/lib/pricing.ts";

/** Build an absolute instant from a local WIB wall-clock time. */
const wib = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h, mi) - 7 * 60 * 60_000);

// ── Timezone primitives ───────────────────────────────────────────────────────

test("localMinutes maps UTC to WIB wall clock", () => {
  assert.equal(localMinutes(new Date("2026-10-02T10:00:00Z")), 17 * 60); // 17:00 WIB
  assert.equal(localMinutes(new Date("2026-10-02T19:00:00Z")), 2 * 60); // 02:00 next day
});

// ── Overlap — Project.md §63 ──────────────────────────────────────────────────

test("half-open intervals: touching endpoints do not overlap", () => {
  const existing = { start: wib(2026, 10, 2, 20), end: wib(2026, 10, 2, 22) };
  assert.equal(
    overlaps({ start: wib(2026, 10, 2, 21), end: wib(2026, 10, 2, 23) }, existing),
    true,
    "21:00–23:00 must conflict with 20:00–22:00",
  );
  assert.equal(
    overlaps({ start: wib(2026, 10, 2, 22), end: wib(2026, 10, 2, 23) }, existing),
    false,
    "22:00–23:00 must not conflict with 20:00–22:00 (§63 second example)",
  );
});

test("conflictsWith honours the handover buffer on both sides", () => {
  const existing: Reservation = {
    tableId: "T1",
    start: wib(2026, 10, 2, 22),
    end: wib(2026, 10, 2, 23),
    active: true,
  };
  // Ends 5 min before the next booking starts — inside the 10 min buffer.
  assert.equal(
    conflictsWith({ start: wib(2026, 10, 2, 20), end: wib(2026, 10, 2, 21, 55) }, existing, 10),
    true,
    "5-minute gap is shorter than the buffer and must conflict",
  );
  // Ends 15 min before — clears the buffer.
  assert.equal(
    conflictsWith({ start: wib(2026, 10, 2, 20), end: wib(2026, 10, 2, 21, 45) }, existing, 10),
    false,
    "15-minute gap clears the buffer",
  );
});

test("inactive reservations never block", () => {
  const dead: Reservation = {
    tableId: "T1",
    start: wib(2026, 10, 2, 20),
    end: wib(2026, 10, 2, 22),
    active: false, // CANCELLED / EXPIRED / COMPLETED / NO_SHOW
  };
  assert.equal(conflictsWith({ start: wib(2026, 10, 2, 20), end: wib(2026, 10, 2, 22) }, dead, 10), false);
});

test("isTableFree only considers the named table", () => {
  const reservations: Reservation[] = [
    { tableId: "T1", start: wib(2026, 10, 2, 20), end: wib(2026, 10, 2, 22), active: true },
  ];
  const slot = { start: wib(2026, 10, 2, 20), end: wib(2026, 10, 2, 22) };
  assert.equal(isTableFree(slot, "T1", reservations, 10), false);
  assert.equal(isTableFree(slot, "T2", reservations, 10), true);
});

// ── Operating hours — D9, midnight crossing ───────────────────────────────────

test("same-day window rejects bookings outside opening hours", () => {
  const win: OperatingWindow = { weekday: 5, opensAtMin: 600, closesAtMin: 1320 }; // 10:00–22:00
  assert.equal(withinOperatingHours(wib(2026, 10, 2, 12), wib(2026, 10, 2, 14), win), true);
  assert.equal(withinOperatingHours(wib(2026, 10, 2, 9), wib(2026, 10, 2, 14), win), false);
  assert.equal(withinOperatingHours(wib(2026, 10, 2, 21), wib(2026, 10, 2, 23), win), false);
});

test("window wrapping midnight accepts a booking that crosses the date boundary", () => {
  const win: OperatingWindow = { weekday: 5, opensAtMin: 600, closesAtMin: 120 }; // 10:00–02:00
  assert.equal(
    withinOperatingHours(wib(2026, 10, 2, 23, 30), wib(2026, 10, 3, 1, 30), win),
    true,
    "23:30→01:30 straddles midnight inside a 10:00–02:00 window",
  );
  assert.equal(
    withinOperatingHours(wib(2026, 10, 2, 1), wib(2026, 10, 2, 3), win),
    false,
    "01:00→03:00 runs past the 02:00 close",
  );
});

test("a wrapping window also accepts bookings entirely inside either segment", () => {
  const win: OperatingWindow = { weekday: 5, opensAtMin: 600, closesAtMin: 120 }; // 10:00–02:00
  // Regression: this used to be rejected because the booking never reached the
  // next calendar day. It sits wholly inside the [10:00, 24:00) segment.
  assert.equal(
    withinOperatingHours(wib(2026, 10, 2, 12), wib(2026, 10, 2, 14), win),
    true,
    "12:00→14:00 is fully inside a venue that opens at 10:00",
  );
  assert.equal(
    withinOperatingHours(wib(2026, 10, 2, 0, 30), wib(2026, 10, 2, 1, 30), win),
    true,
    "00:30→01:30 is fully inside the [00:00, 02:00] segment",
  );
  assert.equal(
    withinOperatingHours(wib(2026, 10, 2, 8), wib(2026, 10, 2, 11), win),
    false,
    "08:00→11:00 starts before the 10:00 open",
  );
});

// ── Extension ceilings — Project.md §38–40 ────────────────────────────────────

const close2am = { closesAtMin: 120, bufferMinutes: 10, maxMinutes: 60 };

test("no next booking: ceiling is the configured max", () => {
  assert.equal(
    maxExtensionMinutes({
      sessionEnd: wib(2026, 10, 2, 22),
      nextBooking: null,
      ...close2am,
    }),
    60,
  );
});

test("next booking 30 min later caps extension at gap minus buffer (§39)", () => {
  assert.equal(
    maxExtensionMinutes({
      sessionEnd: wib(2026, 10, 2, 21),
      nextBooking: { start: wib(2026, 10, 2, 21, 30), end: wib(2026, 10, 2, 23, 30) },
      ...close2am,
    }),
    20, // 30 gap − 10 buffer
  );
});

test("next booking starting exactly at session end means NOT AVAILABLE (§40)", () => {
  const max = maxExtensionMinutes({
    sessionEnd: wib(2026, 10, 2, 21),
    nextBooking: { start: wib(2026, 10, 2, 21), end: wib(2026, 10, 2, 23) },
    ...close2am,
  });
  assert.equal(max, 0);
  assert.deepEqual(allowedExtensionIncrements(max), [], "renders as no options, not +0");
});

test("closing boundary caps extension before the next-booking gap does", () => {
  // Session ends 01:00, venue closes 02:00 → 60 min minus 10 buffer.
  assert.equal(
    maxExtensionMinutes({
      sessionEnd: wib(2026, 10, 3, 1),
      nextBooking: null,
      ...close2am,
    }),
    50,
  );
});

test("allowedExtensionIncrements never offers more than availability permits", () => {
  assert.deepEqual(allowedExtensionIncrements(45), [15, 30]);
  assert.deepEqual(allowedExtensionIncrements(60), [15, 30, 60]);
  assert.deepEqual(allowedExtensionIncrements(10), []);
});

test("minutesToClose rolls to tomorrow when the close is earlier in the day", () => {
  assert.equal(minutesToClose(23 * 60, 120), 180); // 23:00 → 02:00
  assert.equal(minutesToClose(1 * 60, 120), 60); // 01:00 → 02:00
  assert.equal(minutesToClose(14 * 60, 22 * 60), 8 * 60); // 14:00 → 22:00
});

// ── Duration & booking codes ──────────────────────────────────────────────────

test("duration arithmetic", () => {
  assert.equal(durationMinutes(wib(2026, 10, 2, 20), wib(2026, 10, 2, 22)), 120);
  assert.equal(durationMinutes(wib(2026, 10, 2, 20), wib(2026, 10, 3, 1, 30)), 330);
  assert.equal(durationMinutes(wib(2026, 10, 2, 22), wib(2026, 10, 2, 20)), 0, "never negative");
  // 23:30 WIB + 120 min = 01:30 WIB next day = 18:30Z on Oct 2.
  assert.equal(endFromDuration(wib(2026, 10, 2, 23, 30), 120).toISOString(), "2026-10-02T18:30:00.000Z");
});

test("booking codes are readable and exclude ambiguous glyphs", () => {
  // Alphabet is base-32 (10 digits + 22 letters, no I/L/O/U).
  assert.equal(bookingCodeFromSeq(1), "BK-0001");
  assert.equal(bookingCodeFromSeq(36), "BK-0014");
  assert.equal(bookingCodeFromSeq(1000), "BK-00Z8");
  assert.ok(!/I|L|O|U/.test(bookingCodeFromSeq(500).slice(3)), "no I/L/O/U in codes");
});

// ── Pricing — Project.md §12 ──────────────────────────────────────────────────

// From Project.md §12: weekday off-peak 40k, weekday peak 50k.
const weekdayRules: PricingRule[] = [
  { tableType: "REGULAR", weekendOnly: false, startsAtMin: 600, endsAtMin: 1020, hourlyPrice: 40_000, active: true },
  { tableType: "REGULAR", weekendOnly: false, startsAtMin: 1020, endsAtMin: 1440, hourlyPrice: 50_000, active: true },
];
const weekendRules: PricingRule[] = [
  { tableType: "REGULAR", weekendOnly: true, startsAtMin: 600, endsAtMin: 1440, hourlyPrice: 60_000, active: true },
];

test("a slot inside one window is priced pro-rata, not rounded to an hour", () => {
  const q = priceRange(wib(2026, 10, 2, 12), wib(2026, 10, 2, 13, 30), weekdayRules, false);
  assert.equal(q.total, 60_000, "90 min at 40k/h");
  assert.equal(q.unpricedMinutes, 0);
});

test("a slot crossing a pricing boundary is split and summed (§12)", () => {
  // Fri 16:00 → 18:00 = 60 min off-peak + 60 min peak.
  const q = priceRange(wib(2026, 10, 2, 16), wib(2026, 10, 2, 18), weekdayRules, false);
  assert.equal(q.total, 40_000 + 50_000);
  assert.equal(q.slices.length, 2);
  assert.equal(q.unpricedMinutes, 0);
});

test("weekend rules replace weekday rates entirely", () => {
  const q = priceRange(wib(2026, 10, 3, 20), wib(2026, 10, 3, 22), weekendRules, true);
  assert.equal(q.total, 120_000);
});

test("gaps with no active rule are reported, not silently priced at zero", () => {
  const q = priceRange(wib(2026, 10, 2, 3), wib(2026, 10, 2, 4), weekdayRules, false);
  assert.equal(q.total, 0);
  assert.equal(q.unpricedMinutes, 60, "uncovered minutes must surface, not vanish");
});

// ── Deposit — D1 ──────────────────────────────────────────────────────────────

const policy = { percent: 30, minIdr: 25_000, roundingIdr: 1_000 };

test("deposit is 30% with a floor and rounding up", () => {
  assert.equal(depositAmount(200_000, policy), 60_000);
  assert.equal(depositAmount(80_000, policy), 25_000, "floor applies below the 30% value");
  assert.equal(depositAmount(150_000, policy), 45_000);
  assert.equal(depositAmount(0, policy), 0);
});

test("deposit always rounds up to the next thousand", () => {
  assert.equal(depositAmount(101_000, { percent: 30, minIdr: 0, roundingIdr: 1_000 }), 31_000);
  assert.equal(depositAmount(110_000, { percent: 30, minIdr: 0, roundingIdr: 1_000 }), 33_000);
});

// ── Overage — D5 ──────────────────────────────────────────────────────────────

const overage = { graceMinutes: 15, incrementMinutes: 15, hourlyPrice: 50_000 };

test("ending inside the grace period is free", () => {
  assert.equal(
    overageCharge({ actualEnd: wib(2026, 10, 2, 22, 10), scheduledEndAt: wib(2026, 10, 2, 22), ...overage }),
    0,
  );
});

test("overage past the grace period bills whole 15-minute blocks", () => {
  // Ends 22:20; grace to 22:15, then 5 min → one 15-min block.
  assert.equal(
    overageCharge({ actualEnd: wib(2026, 10, 2, 22, 20), scheduledEndAt: wib(2026, 10, 2, 22), ...overage }),
    12_500,
  );
  // Ends 22:45; grace to 22:15, then 30 min → two blocks.
  assert.equal(
    overageCharge({ actualEnd: wib(2026, 10, 2, 22, 45), scheduledEndAt: wib(2026, 10, 2, 22), ...overage }),
    25_000,
  );
});

// ── Settlement ────────────────────────────────────────────────────────────────

test("settleable balance subtracts paid amounts and never goes negative", () => {
  assert.equal(settleableBalance({ totalPrice: 200_000, extensionTotal: 0, paidTotal: 50_000 }), 150_000);
  assert.equal(settleableBalance({ totalPrice: 200_000, extensionTotal: 50_000, paidTotal: 50_000 }), 200_000);
  assert.equal(settleableBalance({ totalPrice: 200_000, extensionTotal: 0, paidTotal: 250_000 }), 0);
});