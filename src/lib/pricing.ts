/**
 * Pricing engine — Project.md §12, §43.
 *
 * A booking can span several pricing windows (weekday off-peak 10:00–17:00 then
 * peak 17:00–00:00), so total price is computed by splitting the range at rule
 * boundaries and summing each slice at its own rate.
 *
 * All amounts are whole rupiah. Indonesian practice is to transact in integer
 * rupiah; introducing a subunit here would only create rounding bugs.
 */

import { WIB_OFFSET_MIN } from "./availability.ts";

export type PricingRule = {
  tableType: "REGULAR" | "VIP";
  weekendOnly: boolean;
  /** Minutes from local midnight. */
  startsAtMin: number;
  endsAtMin: number;
  hourlyPrice: number;
  active: boolean;
};

export type PriceSlice = {
  start: Date;
  end: Date;
  minutes: number;
  hourlyPrice: number;
  subtotal: number;
};

export type PriceQuote = {
  total: number;
  slices: PriceSlice[];
  /** Minutes that no active rule covered. Should be 0 in a healthy config. */
  unpricedMinutes: number;
};

/**
 * Split `start`–`end` at pricing-rule boundaries and price each slice.
 *
 * `rules` must already be filtered to the relevant table type. Rule precedence
 * is most-specific-first: a weekend-only rule beats a weekday rule, and among
 * equals the narrower time window wins.
 */
export function priceRange(
  start: Date,
  end: Date,
  rules: PricingRule[],
  isWeekend: boolean,
): PriceQuote {
  if (end <= start) {
    return { total: 0, slices: [], unpricedMinutes: 0 };
  }

  const applicable = rules
    .filter((r) => r.active && r.weekendOnly === isWeekend)
    .sort(
      (a, b) =>
        Number(b.weekendOnly) - Number(a.weekendOnly) ||
        b.endsAtMin - b.startsAtMin - (a.endsAtMin - a.startsAtMin),
    );

  const boundaries = collectBoundaries(start, end, applicable);
  const slices: PriceSlice[] = [];
  let total = 0;
  let unpricedMinutes = 0;

  for (let i = 0; i < boundaries.length - 1; i++) {
    const sliceStart = boundaries[i];
    const sliceEnd = boundaries[i + 1];
    const minutes = Math.round((sliceEnd.getTime() - sliceStart.getTime()) / 60_000);
    if (minutes <= 0) continue;

    const atSliceStart = applicable.find((r) => coversInstant(r, sliceStart));
    if (!atSliceStart) {
      unpricedMinutes += minutes;
      continue;
    }

    // Pro-rate by the actual elapsed minutes rather than rounding to a whole
    // hour — a 90-minute slot at Rp40.000/h is Rp60.000, not Rp80.000.
    const subtotal = Math.round((atSliceStart.hourlyPrice * minutes) / 60);
    total += subtotal;
    slices.push({
      start: sliceStart,
      end: sliceEnd,
      minutes,
      hourlyPrice: atSliceStart.hourlyPrice,
      subtotal,
    });
  }

  return { total, slices, unpricedMinutes };
}

/** Whether a rule covers the given instant, honouring midnight wrap. */
function coversInstant(rule: PricingRule, at: Date): boolean {
  const local = new Date(at.getTime() + WIB_OFFSET_MIN * 60_000);
  const min = local.getUTCHours() * 60 + local.getUTCMinutes();
  const { startsAtMin: s, endsAtMin: e } = rule;
  if (s <= e) return min >= s && min < e;
  return min >= s || min < e; // wraps past midnight
}

/**
 * Start, end, plus every rule boundary that falls strictly inside the range.
 * Boundaries are derived from the local-time-of-day of the range endpoints,
 * repeated across each local day the range touches.
 */
function collectBoundaries(
  start: Date,
  end: Date,
  rules: PricingRule[],
): Date[] {
  const points = new Set<number>([start.getTime(), end.getTime()]);

  // Walk each local day the range touches, at most 2 — a booking cannot be
  // longer than a venue's opening window.
  const firstDay = localDayStart(start);
  for (let dayOffset = 0; dayOffset < 2; dayOffset++) {
    const dayBase = new Date(firstDay.getTime() + dayOffset * 86_400_000);
    for (const rule of rules) {
      for (const min of [rule.startsAtMin, rule.endsAtMin]) {
        const at = new Date(dayBase.getTime() + min * 60_000);
        if (at > start && at < end) points.add(at.getTime());
      }
    }
  }

  return [...points].sort((a, b) => a - b).map((t) => new Date(t));
}

/** Local midnight (WIB) of the day containing `at`. */
function localDayStart(at: Date): Date {
  const shifted = new Date(at.getTime() + WIB_OFFSET_MIN * 60_000);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      WIB_OFFSET_MIN * 60_000,
  );
}

// ── Deposit & overage ──────────────────────────────────────────────────────────

export type DepositPolicy = {
  percent: number;
  minIdr: number;
  /** Round the computed deposit UP to a multiple of this. */
  roundingIdr: number;
};

/**
 * Required deposit — D1: 30% of total, floor of Rp25.000, rounded UP to the
 * nearest Rp1.000 so the venue never receives less than 30% after rounding.
 */
export function depositAmount(total: number, policy: DepositPolicy): number {
  if (total <= 0) return 0;
  const raw = Math.ceil((total * policy.percent) / 100);
  const stepped =
    policy.roundingIdr > 1
      ? Math.ceil(Math.max(raw, policy.minIdr) / policy.roundingIdr) * policy.roundingIdr
      : Math.max(raw, policy.minIdr);
  return stepped;
}

/**
 * Overage charge past the grace period — D5.
 *
 * Anything inside the grace period is free; anything past it is charged in
 * whole `incrementMinutes` blocks (rounded up), at the rate prevailing at
 * `scheduledEndAt`.
 */
export function overageCharge(args: {
  actualEnd: Date;
  scheduledEndAt: Date;
  graceMinutes: number;
  incrementMinutes: number;
  hourlyPrice: number;
}): number {
  const { actualEnd, scheduledEndAt, graceMinutes, incrementMinutes, hourlyPrice } = args;
  const billableMin =
    (actualEnd.getTime() - scheduledEndAt.getTime()) / 60_000 - graceMinutes;
  if (billableMin <= 0) return 0;
  const blocks = Math.ceil(billableMin / incrementMinutes);
  return Math.round((hourlyPrice * blocks * incrementMinutes) / 60);
}

/**
 * Settleable balance at checkout: booked total plus approved extensions, minus
 * everything already PAID. Never negative — an overpaid booking settles at 0 and
 * the surplus is handled as a refund, not as a negative bill.
 */
export function settleableBalance(args: {
  totalPrice: number;
  extensionTotal: number;
  paidTotal: number;
}): number {
  const { totalPrice, extensionTotal, paidTotal } = args;
  return Math.max(0, totalPrice + extensionTotal - paidTotal);
}