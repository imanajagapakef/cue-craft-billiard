/**
 * Availability engine — Project.md §62, §63, §64.
 *
 * Pure functions, no database access. The database exclusion constraint is the
 * final authority (it catches races this module cannot see); this module is the
 * fast path that answers "which tables can I offer?" without a write.
 *
 * Timezone: the venue is WIB (UTC+7), which has never observed DST. A fixed
 * offset is therefore correct, not a shortcut, and it keeps these functions
 * deterministic under test. If a second venue opens in a DST zone, this becomes
 * a real timezone-database lookup.
 */

export const WIB_OFFSET_MIN = 7 * 60;

const MIN_PER_DAY = 1440;
const MS_PER_MIN = 60_000;

export type Interval = { start: Date; end: Date };

export type OperatingWindow = {
  /** 0 = Sunday … 6 = Saturday, matching JS getUTCDay. */
  weekday: number;
  /** Minutes from local midnight. */
  opensAtMin: number;
  /** Minutes from local midnight. May be < opensAtMin, meaning it wraps past midnight. */
  closesAtMin: number;
};

export type Reservation = Interval & {
  tableId: string;
  /**
   * True while the booking still owns the slot. Terminal statuses
   * (CANCELLED/EXPIRED/COMPLETED/NO_SHOW) are inactive and must not block
   * rebooking — this mirrors the WHERE clause on the `no_overlap` constraint.
   */
  active: boolean;
};

/** Minutes from local midnight, in [0, 1440). */
export function localMinutes(date: Date, offsetMin = WIB_OFFSET_MIN): number {
  return (
    Math.floor((date.getTime() + offsetMin * MS_PER_MIN) / MS_PER_MIN) % MIN_PER_DAY
  );
}

/** Local weekday, 0 = Sunday … 6 = Saturday. */
export function localWeekday(date: Date, offsetMin = WIB_OFFSET_MIN): number {
  return new Date(date.getTime() + offsetMin * MS_PER_MIN).getUTCDay();
}

/**
 * Half-open interval overlap: [start, end). A booking ending 22:00 and one
 * starting 22:00 do NOT overlap — Project.md §63.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Overlap accounting for the handover buffer (D6).
 *
 * The buffer must fit on BOTH sides of a gap: 10 minutes between the previous
 * session ending and this one starting, and 10 minutes between this one ending
 * and the next booking. Expanding both ranges by the buffer is equivalent to
 * pushing them apart, and costs one comparison instead of four gap checks.
 *
 * ponytail: expand-and-compare rather than explicit gap arithmetic. Upgrade if
 * the buffer ever becomes asymmetric per side.
 */
export function conflictsWith(
  requested: Interval,
  existing: Reservation,
  bufferMinutes: number,
): boolean {
  if (!existing.active) return false;
  const pad = bufferMinutes * MS_PER_MIN;
  return (
    requested.start.getTime() - pad < existing.end.getTime() &&
    existing.start.getTime() < requested.end.getTime() + pad
  );
}

/** True when `tableId` has no active reservation conflicting with `requested`. */
export function isTableFree(
  requested: Interval,
  tableId: string,
  reservations: Reservation[],
  bufferMinutes: number,
): boolean {
  return !reservations.some(
    (r) => r.tableId === tableId && conflictsWith(requested, r, bufferMinutes),
  );
}

/**
 * Whether [start, end] sits inside the operating window for its weekday,
 * handling a window that wraps past midnight (D9: 10:00 → 02:00).
 *
 * A wrapping window is two contiguous segments of one day: [opens, 24:00) and
 * [00:00, closes]. A booking is valid if it fits entirely inside the evening
 * segment, entirely inside the morning segment, or straddles the boundary
 * between them. It does NOT have to reach the next day — a 12:00–14:00 booking
 * is fully inside a venue that closes at 02:00.
 */
export function withinOperatingHours(
  start: Date,
  end: Date,
  hours: OperatingWindow,
  offsetMin = WIB_OFFSET_MIN,
): boolean {
  const startMin = localMinutes(start, offsetMin);
  const endMin = localMinutes(end, offsetMin);
  const { opensAtMin: opens, closesAtMin: closes } = hours;

  if (opens === closes) return false; // venue shut all day

  if (closes <= opens) {
    const sameLocalDay = localWeekday(start, offsetMin) === localWeekday(end, offsetMin);

    if (sameLocalDay) {
      // Both ends on one local day, so endMin >= startMin.
      if (startMin >= opens) return true; // evening segment, ends before midnight
      return endMin <= closes; // morning segment, starts after midnight
    }

    // Straddles midnight: must begin in the evening and end in the small hours.
    return startMin >= opens && endMin <= closes;
  }

  // Same-day window.
  if (startMin < opens || endMin > closes) return false;
  return endMin >= startMin;
}

/**
 * Absolute end time for a booking that starts at `start` and runs `minutes`.
 * Midnight is never special-cased: the result is start + minutes, and interval
 * comparison handles the date boundary (D9).
 */
export function endFromDuration(start: Date, minutes: number): Date {
  return new Date(start.getTime() + minutes * MS_PER_MIN);
}

/** Duration in whole minutes between two instants, floored, never negative. */
export function durationMinutes(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / MS_PER_MIN));
}

/**
 * Minutes from a local wall-clock time to the next closing boundary, for a
 * session ending at local time `endMin`.
 *
 * If closing is later in the day than `endMin`, the boundary is today.
 * Otherwise it is tomorrow — which is the normal case for a venue that closes
 * at 02:00 while a session runs to 01:00.
 */
export function minutesToClose(endMin: number, closesAtMin: number): number {
  return closesAtMin > endMin
    ? closesAtMin - endMin
    : closesAtMin + MIN_PER_DAY - endMin;
}

/**
 * Largest extension a session ending at `sessionEnd` may take, in minutes.
 *
 * Three independent ceilings, smallest wins (Project.md §38–40):
 *   1. Gap to the next booking on the same table, minus buffer.
 *   2. Minutes to the operating-hours closing boundary, minus buffer.
 *   3. The venue's configured maximum single extension (D7).
 *
 * Returns 0 when the next booking starts exactly at session end (§40) — the
 * caller must render that as "NOT AVAILABLE", never as "+0 min".
 */
export function maxExtensionMinutes(args: {
  sessionEnd: Date;
  /** Next active reservation on the same table after sessionEnd, or null. */
  nextBooking: Interval | null;
  /** Minutes from local midnight at which the venue closes. */
  closesAtMin: number;
  bufferMinutes: number;
  maxMinutes: number;
  offsetMin?: number;
}): number {
  const {
    sessionEnd,
    nextBooking,
    closesAtMin,
    bufferMinutes,
    maxMinutes,
    offsetMin = WIB_OFFSET_MIN,
  } = args;

  let ceiling = maxMinutes;

  if (nextBooking) {
    const gap = (nextBooking.start.getTime() - sessionEnd.getTime()) / MS_PER_MIN;
    ceiling = Math.min(ceiling, gap - bufferMinutes);
  }

  ceiling = Math.min(
    ceiling,
    minutesToClose(localMinutes(sessionEnd, offsetMin), closesAtMin) - bufferMinutes,
  );

  return Math.max(0, Math.floor(ceiling));
}

/**
 * Allowed extension increments (D7: 15/30/60), filtered down to what
 * availability actually permits. Prevents the §41 failure where the screen
 * offers "+1 hour" and the submit is rejected.
 */
export function allowedExtensionIncrements(
  maxMinutes: number,
  increments: number[] = [15, 30, 60],
): number[] {
  return increments
    .filter((m) => m > 0 && m <= maxMinutes)
    .sort((a, b) => a - b);
}

// ── Booking code ───────────────────────────────────────────────────────────────

// Crockford-style alphabet: no I, L, O, U. Those are the characters most
// misread when a code is read aloud on the phone, which is exactly how
// Project.md §14 says a booking code gets used.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Candidate booking code from a sequence value, e.g. 1 → "BK-0001".
 *
 * Uniqueness is enforced by the DB unique index; the caller retries on
 * conflict, so a collision is a rare path rather than a hot one.
 */
export function bookingCodeFromSeq(seq: number): string {
  let n = Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : 1;
  let out = "";
  do {
    out = CODE_ALPHABET[n % CODE_ALPHABET.length] + out;
    n = Math.floor(n / CODE_ALPHABET.length);
  } while (n > 0);
  return `BK-${out.padStart(4, "0")}`;
}