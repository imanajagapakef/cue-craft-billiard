/**
 * Double-booking guard test — Project.md §64.
 *
 * Run: npx tsx scripts/test-double-booking.ts
 *
 * This is the one behaviour that cannot be verified by reading code. Every other
 * assertion in the suite tests a function; this tests the DATABASE refusing to
 * accept two reservations for the same table and window.
 *
 * Works on any row in the bookings table and cleans up after itself, so it can
 * be run repeatedly against dev or CI without leaving state behind.
 */

import { PrismaClient, BookingStatus, BookingSource } from "@prisma/client";

const db = new PrismaClient();

const WINDOW_START = new Date("2026-11-20T13:00:00Z"); // 20:00 WIB
const WINDOW_END = new Date("2026-11-20T15:00:00Z"); // 22:00 WIB
const RUN_TAG = `constraint-probe-${Date.now()}`;

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function makeBooking(
  code: string,
  tableId: string,
  startAt: Date,
  endAt: Date,
  status: BookingStatus = "CONFIRMED",
): Promise<void> {
  await db.booking.create({
    data: {
      code,
      customerName: "Constraint Probe",
      customerPhone: "080000000000",
      tableId,
      startAt,
      endAt,
      durationMinutes: Math.round((endAt.getTime() - startAt.getTime()) / 60_000),
      totalPrice: 100_000,
      depositAmount: 30_000,
      remainingAmount: 70_000,
      status,
      source: BookingSource.ADMIN,
      holdExpiresAt: null,
    },
  });
}

/** True when the insert was rejected by the exclusion constraint. */
async function expectRejected(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Postgres exclusion violation, surfaced by Prisma as the raw driver text.
    return msg.includes("23P01") || msg.includes("no_overlap");
  }
}

async function main() {
  const [tableA, tableB] = await Promise.all([
    db.table.findFirstOrThrow({ where: { code: "TBL-04" } }),
    db.table.findFirstOrThrow({ where: { code: "TBL-09" } }),
  ]);

  console.log(`\nDouble-booking guard — ${RUN_TAG}`);
  console.log(`window 20:00–22:00 WIB · TBL-04 = ${tableA.code}, TBL-09 = ${tableB.code}\n`);

  try {
    // 1. Baseline: the slot must be free.
    await makeBooking(`${RUN_TAG}-a1`, tableA.id, WINDOW_START, WINDOW_END);
    check("1. first booking on TBL-04 accepted", true, true);

    // 2. Same table, identical window — must be refused. This is the whole
    //    point of the constraint.
    check(
      "2. identical window on same table refused",
      await expectRejected(() =>
        makeBooking(`${RUN_TAG}-a2`, tableA.id, WINDOW_START, WINDOW_END),
      ),
      true,
    );

    // 3. Same table, partial overlap (21:00–23:00) — must be refused.
    check(
      "3. partial overlap on same table refused",
      await expectRejected(() =>
        makeBooking(
          `${RUN_TAG}-a3`,
          tableA.id,
          new Date("2026-11-20T14:00:00Z"),
          new Date("2026-11-20T16:00:00Z"),
        ),
      ),
      true,
    );

    // 4. Same table, contained entirely — must be refused.
    check(
      "4. fully-contained window on same table refused",
      await expectRejected(() =>
        makeBooking(
          `${RUN_TAG}-a4`,
          tableA.id,
          new Date("2026-11-20T13:30:00Z"),
          new Date("2026-11-20T14:00:00Z"),
        ),
      ),
      true,
    );

    // 5. Adjacent, starting exactly when the first ends — must be ACCEPTED.
    //    Half-open [start, end) per Project.md §63.
    await makeBooking(`${RUN_TAG}-a5`, tableA.id, WINDOW_END, new Date("2026-11-20T17:00:00Z"));
    check("5. adjacent window (starts at first booking's end) accepted", true, true);

    // 6. Different table, identical window — must be ACCEPTED.
    await makeBooking(`${RUN_TAG}-b1`, tableB.id, WINDOW_START, WINDOW_END);
    check("6. same window on a different table accepted", true, true);

    // 7. The handover buffer is an application concern, not the constraint's.
    //    A 5-minute gap is legal at the database level; availability.ts is what
    //    rejects it. Recorded here so the boundary of each layer stays explicit.
    check(
      "7. 5-minute gap allowed by the DB (buffer enforced in availability.ts, not here)",
      await expectRejected(() =>
        makeBooking(
          `${RUN_TAG}-a6`,
          tableA.id,
          new Date("2026-11-20T17:05:00Z"),
          new Date("2026-11-20T18:00:00Z"),
        ),
      ),
      false,
    );

    // 8. Cancel the original, then confirm the slot frees up. Proves the
    //    constraint's WHERE clause drops terminal statuses.
    await db.booking.update({
      where: { code: `${RUN_TAG}-a1` },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelParty: "CUSTOMER" },
    });
    check(
      "8. slot reusable after the original booking is CANCELLED",
      await expectRejected(() =>
        makeBooking(`${RUN_TAG}-a7`, tableA.id, WINDOW_START, WINDOW_END),
      ),
      false,
    );

    // 9. Two genuinely concurrent inserts, racing. Promise.all on two separate
    //    queries — exactly the Project.md §64 scenario. Exactly one must win.
    //    Uses its own window so the two race each other rather than colliding
    //    with the row written by step 6.
    const raceStart = new Date("2026-11-21T04:00:00Z"); // 11:00 WIB
    const raceEnd = new Date("2026-11-21T06:00:00Z"); // 13:00 WIB
    const before = await db.booking.count({
      where: { tableId: tableB.id, startAt: raceStart, endAt: raceEnd },
    });
    const results = await Promise.allSettled([
      makeBooking(`${RUN_TAG}-r1`, tableB.id, raceStart, raceEnd),
      makeBooking(`${RUN_TAG}-r2`, tableB.id, raceStart, raceEnd),
    ]);
    const winners = results.filter((r) => r.status === "fulfilled").length;
    const after = await db.booking.count({
      where: { tableId: tableB.id, startAt: raceStart, endAt: raceEnd },
    });
    check("9a. concurrent race produced a row", after - before, 1);
    check(
      "9b. exactly one of two concurrent inserts won (one rejected by the constraint)",
      winners,
      1,
    );
    check("9c. loser was rejected by the exclusion constraint", await (async () => {
      const loser = results.find((r) => r.status === "rejected");
      if (loser === undefined || loser.status !== "rejected") return false;
      const msg = loser.reason instanceof Error ? loser.reason.message : String(loser.reason);
      return msg.includes("23P01") || msg.includes("no_overlap");
    })(), true);
  } finally {
    const { count } = await db.booking.deleteMany({ where: { code: { startsWith: RUN_TAG } } });
    console.log(`\ncleanup: removed ${count} probe rows`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());