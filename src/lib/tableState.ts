/**
 * Table state derivation — docs/TECH_DESIGN.md §4.
 *
 * Only MAINTENANCE is stored state; it is set by staff and nothing else can set
 * it. Every other status is derived from the bookings and sessions that justify
 * it, in the same query. Storing HELD or OCCUPIED would create a second source of
 * truth that can drift from the booking rows, and drift here means showing a
 * customer a table that is actually taken.
 *
 * ponytail: one query returning already-derived state, instead of a stored column
 * plus N repair paths for every way it can go stale.
 */

import { db } from "./db.ts";

export type DerivedTableState = "AVAILABLE" | "HELD" | "RESERVED" | "OCCUPIED" | "MAINTENANCE";

export type TableState = {
  tableId: string;
  code: string;
  name: string;
  type: "REGULAR" | "VIP";
  zone: string | null;
  sortOrder: number;
  storedStatus: "AVAILABLE" | "HELD" | "OCCUPIED" | "MAINTENANCE";
  state: DerivedTableState;
  /** Ends when this table next frees up; null when free or in maintenance. */
  busyUntil: Date | null;
  /**
   * Hold lapse time, present only while HELD. The cashier needs this, not
   * `busyUntil`: the question on a held table is "how long until the hold frees
   * it", not "how long until the booked session would end".
   */
  holdExpiresAt: Date | null;
  bookingCode: string | null;
  customerName: string | null;
  /** Minutes until the current or upcoming session ends; null when free. */
  minutesRemaining: number | null;
};

const RESERVING: ReadonlyArray<"PENDING" | "AWAITING_DEPOSIT" | "CONFIRMED" | "CHECKED_IN"> = [
  "PENDING",
  "AWAITING_DEPOSIT",
  "CONFIRMED",
  "CHECKED_IN",
];

/**
 * Live state for every active table. Expiry is swept first so a lapsed hold is
 * not reported as HELD.
 */
export async function getTableStates(): Promise<TableState[]> {
  await db.booking.updateMany({
    where: { status: "AWAITING_DEPOSIT", holdExpiresAt: { lt: new Date() } },
    data: { status: "EXPIRED", holdExpiresAt: null },
  });

  const now = new Date();

  const [tables, sessions, bookings] = await Promise.all([
    db.table.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.session.findMany({
      where: { status: { in: ["ACTIVE", "OVERDUE"] } },
      select: {
        tableId: true,
        startedAt: true,
        scheduledEndAt: true,
        extendedMinutes: true,
        status: true,
        booking: { select: { code: true, customerName: true, endAt: true } },
      },
    }),
    db.booking.findMany({
      where: {
        status: { in: ["AWAITING_DEPOSIT", "CONFIRMED"] },
        // A hold that lapsed counts as absent even before its row is swept.
        OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
        // Only reservations starting within a day can be the "next" one.
        startAt: { lte: new Date(now.getTime() + 86_400_000) },
      },
      orderBy: { startAt: "asc" },
      select: {
        tableId: true,
        code: true,
        status: true,
        customerName: true,
        startAt: true,
        endAt: true,
        holdExpiresAt: true,
      },
    }),
  ]);

  const sessionByTable = new Map(sessions.map((s) => [s.tableId, s]));
  // First upcoming reservation per table, regardless of how far out it is.
  const nextByTable = new Map<string, (typeof bookings)[number]>();
  for (const b of bookings) {
    if (!nextByTable.has(b.tableId)) nextByTable.set(b.tableId, b);
  }

  return tables.map((t) => {
    const session = sessionByTable.get(t.id);
    const next = nextByTable.get(t.id);

    if (t.status === "MAINTENANCE") {
      return base(t, "MAINTENANCE", null, null, null, null, null);
    }
    if (session) {
      const end = sessionEndWithExtension(session.scheduledEndAt, session.extendedMinutes);
      return base(
        t,
        "OCCUPIED",
        end,
        session.booking.code,
        session.booking.customerName,
        end,
        null,
      );
    }
    if (next) {
      return base(
        t,
        next.status === "AWAITING_DEPOSIT" ? "HELD" : "RESERVED",
        next.endAt,
        next.code,
        next.customerName,
        next.endAt,
        next.status === "AWAITING_DEPOSIT" ? next.holdExpiresAt : null,
      );
    }
    return base(t, "AVAILABLE", null, null, null, null, null);
  });
}

function sessionEndWithExtension(scheduledEndAt: Date, extendedMinutes: number): Date {
  return new Date(scheduledEndAt.getTime() + extendedMinutes * 60_000);
}

function base(
  t: {
    id: string;
    code: string;
    name: string;
    type: "REGULAR" | "VIP";
    zone: string | null;
    sortOrder: number;
    status: "AVAILABLE" | "HELD" | "OCCUPIED" | "MAINTENANCE";
  },
  state: DerivedTableState,
  busyUntil: Date | null,
  bookingCode: string | null,
  customerName: string | null,
  until: Date | null,
  holdExpiresAt: Date | null,
): TableState {
  return {
    tableId: t.id,
    code: t.code,
    name: t.name,
    type: t.type,
    zone: t.zone,
    sortOrder: t.sortOrder,
    storedStatus: t.status,
    state,
    busyUntil,
    holdExpiresAt,
    bookingCode,
    customerName,
    minutesRemaining: until ? Math.round((until.getTime() - Date.now()) / 60_000) : null,
  };
}

export { RESERVING };