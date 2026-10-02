/**
 * Full operational scenario — the MVP success path from Project.md §80.
 *
 * Run: npx tsx scripts/test-flow.ts
 *
 *   availability → create booking → upload proof → verify payment
 *   → check-in → extension → checkout → completed
 *
 * Writes tagged rows and cleans up after itself, so it is safe to run repeatedly
 * against dev. This is the manual verification listed in
 * docs/TECH_DESIGN.md §15 step 6, made repeatable.
 */

import { PrismaClient } from "@prisma/client";

import { db } from "../src/lib/db.ts";
import {
  createBooking,
  endSession,
  getAvailability,
  requestExtension,
  submitProof,
  checkIn,
  verifyPayment,
  DomainError,
  localInstant,
} from "../src/lib/bookings.ts";
import { getSettings } from "../src/lib/settings.ts";
import { dispatchPendingNotifications } from "../src/lib/notify.ts";
import { WIB_OFFSET_MIN } from "../src/lib/availability.ts";

const client = new PrismaClient();

/**
 * Staff actions write `verified_by` / `approved_by` foreign keys, so the actor
 * must be a real seeded user. A made-up id would fail the FK, not the logic.
 * Resolved inside main() because top-level await is not available in CJS output.
 */
async function staffActor() {
  const user = await client.user.findUniqueOrThrow({
    where: { email: "kasir@cueandrail.test" },
  });
  return { type: "STAFF" as const, id: user.id, name: user.name };
}

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

/**
 * Pick a start time that is inside operating hours and far enough ahead that
 * check-in and extension behave sensibly. Candidates are tried in order so the
 * script works at any hour of the day.
 */
async function pickStart(): Promise<Date> {
  const hours = await client.operatingHour.findMany({ where: { active: true } });
  const weekday = new Date(Date.now() + WIB_OFFSET_MIN * 60_000).getUTCDay();
  const today = hours.find((h) => h.weekday === weekday);
  if (!today) throw new Error("No operating hours seeded");

  // Two hours inside the window, which leaves room before both open and close.
  const inside =
    today.closesAtMin > today.opensAtMin
      ? today.opensAtMin + 120
      : today.opensAtMin + 120;

  const todayDate = new Date(Date.now() + WIB_OFFSET_MIN * 60_000)
    .toISOString()
    .slice(0, 10);

  const candidates: Date[] = [
    // Today, if that slot has not passed.
    localInstant(todayDate, inside),
    // Tomorrow, always safe.
    localInstant(
      new Date(Date.now() + WIB_OFFSET_MIN * 60_000 + 86_400_000)
        .toISOString()
        .slice(0, 10),
      inside,
    ),
  ];

  for (const c of candidates) {
    if (c.getTime() < Date.now() + 60 * 60_000) continue;
    return c;
  }
  throw new Error("Could not find a workable start time");
}

async function main() {
  const staff = await staffActor();
  const settings = await getSettings();
  const start = await pickStart();
  const durationMin = 120;

  const dateStr = new Date(start.getTime() + WIB_OFFSET_MIN * 60_000)
    .toISOString()
    .slice(0, 10);
  const startMin = Math.floor(
    (start.getTime() + WIB_OFFSET_MIN * 60_000 - Date.UTC(
      Number(dateStr.slice(0, 4)),
      Number(dateStr.slice(5, 7)) - 1,
      Number(dateStr.slice(8, 10)),
    )) / 60_000,
  );

  const tag = `flow-${Date.now()}`;
  let bookingCode: string | null = null;

  console.log(`\nFull flow — ${tag}`);
  console.log(`start ${start.toISOString()} · ${durationMin} min · buffer ${settings.bufferMinutes} min\n`);

  try {
    // ── 1. Availability ──────────────────────────────────────────────────────
    const before = await getAvailability({ date: dateStr, startMin, durationMin });
    check("1. availability returns every active table", before.length, 12);
    check(
      "2. every table is available before any booking",
      before.filter((r) => r.available).length,
      12,
    );
    const target = before[0];
    check("3. an available table carries a positive price", target.totalPrice > 0, true);
    check(
      "4. deposit is the configured percentage of the total",
      target.depositAmount,
      Math.ceil(target.totalPrice * (settings.depositPercent / 100)),
    );

    // ── 2. Create booking ────────────────────────────────────────────────────
    const idempotencyKey = `${tag}-key`;
    const created = await createBooking({
      customerName: "Flow Probe",
      customerPhone: "081234567890",
      tableId: target.tableId,
      startAt: start,
      durationMin,
      paymentMethod: "QRIS",
      idempotencyKey,
    });
    bookingCode = created.booking.code;
    check("5. booking created", created.booking.status, "AWAITING_DEPOSIT");
    check("6. booking code uses the BK- prefix", /^BK-[0-9A-Z]{4,8}$/.test(bookingCode), true);
    check("7. deposit matches the availability quote", created.booking.depositAmount, target.depositAmount);
    check(
      "8. remaining is total minus deposit",
      created.booking.remainingAmount,
      created.booking.totalPrice - created.booking.depositAmount,
    );
    check(
      "9. hold expiry is ~hold_duration from now",
      Math.abs(
        (created.booking.holdExpiresAt!.getTime() - Date.now()) / 60_000 - settings.holdDurationMinutes,
      ) < 2,
      true,
    );

    // ── 3. Idempotent replay (§8) ────────────────────────────────────────────
    const replay = await createBooking({
      customerName: "Flow Probe",
      customerPhone: "081234567890",
      tableId: target.tableId,
      startAt: start,
      durationMin,
      paymentMethod: "QRIS",
      idempotencyKey,
    });
    check("10. replayed request returns the same booking, not a second one", replay.booking.code, bookingCode);
    check("11. replay is flagged as such", replay.replayed, true);

    // ── 4. Availability reflects the hold ───────────────────────────────────
    const after = await getAvailability({ date: dateStr, startMin, durationMin });
    check(
      "12. held table no longer appears available",
      after.find((r) => r.tableId === target.tableId)!.available,
      false,
    );
    check(
      "13. other tables stay available",
      after.filter((r) => r.available).length,
      11,
    );

    // ── 5. Double booking refused (§64) ──────────────────────────────────────
    let doubleRejected = false;
    try {
      await createBooking({
        customerName: "Second Customer",
        customerPhone: "089999999999",
        tableId: target.tableId,
        startAt: start,
        durationMin,
        paymentMethod: "QRIS",
        idempotencyKey: `${tag}-second`,
      });
    } catch (e) {
      doubleRejected = e instanceof DomainError || String(e).includes("23P01");
    }
    check("14. second booking on the same table and window is refused", doubleRejected, true);

    // ── 6. Wrong phone cannot act on the booking ─────────────────────────────
    let phoneBlocked = false;
    try {
      await submitProof({ bookingCode: bookingCode!, customerPhone: "089000000000", proofPath: "/x.png" });
    } catch (e) {
      phoneBlocked = e instanceof DomainError && e.code === "PHONE_MISMATCH";
    }
    check("15. booking code alone is not enough to act on a booking", phoneBlocked, true);

    // ── 7. QRIS proof → verify ───────────────────────────────────────────────
    await submitProof({
      bookingCode: bookingCode!,
      customerPhone: "081234567890",
      proofPath: `/uploads/proof/${bookingCode}/probe.png`,
    });
    const depositRow = await client.payment.findFirstOrThrow({
      where: { bookingId: created.booking.id, kind: "DEPOSIT" },
    });
    check("16. deposit payment moves to PROOF_SUBMITTED", depositRow.status, "PROOF_SUBMITTED");

    const confirmed = await verifyPayment({ paymentId: depositRow.id, staff, approve: true });
    check("17. verifying the deposit confirms the booking", confirmed.booking.status, "CONFIRMED");

    const replayConfirm = await verifyPayment({ paymentId: depositRow.id, staff, approve: true });
    check("18. confirming twice is idempotent", replayConfirm.alreadyApplied, true);

    // ── 8. Check-in ──────────────────────────────────────────────────────────
    const checkedIn = await checkIn({ bookingCode: bookingCode!, staff });
    check("19. check-in moves the booking to CHECKED_IN", checkedIn.booking.status, "CHECKED_IN");
    check(
      "20. session scheduled end is anchored to the booked end (D4)",
      checkedIn.session.scheduledEndAt.toISOString(),
      created.booking.endAt.toISOString(),
    );
    check(
      "21. session started at the real check-in time",
      Math.abs(checkedIn.session.startedAt.getTime() - Date.now()) < 60_000,
      true,
    );

    // ── 9. Extension ─────────────────────────────────────────────────────────
    let extensionBlocked = false;
    try {
      await requestExtension({ sessionId: checkedIn.session.id, minutes: 600, staff });
    } catch (e) {
      extensionBlocked = e instanceof DomainError && e.code === "EXTENSION_TOO_LONG";
    }
    check("22. an over-long extension is refused with a maximum", extensionBlocked, true);

    const extension = await requestExtension({
      sessionId: checkedIn.session.id,
      minutes: 30,
      staff,
    });
    check("23. a permitted extension is accepted", extension.extension.approvedMinutes, 30);
    check("24. extension is priced, not free", extension.price > 0, true);
    check("25. extension starts as PENDING payment", extension.extension.status, "PENDING");

    const extPayment = await client.payment.findFirstOrThrow({
      where: { extensionId: extension.extension.id },
    });

    const beforeEndAt = created.booking.endAt;
    const afterExtend = await verifyPayment({ paymentId: extPayment.id, staff, approve: true });
    check(
      "26. paying the extension pushes the booking end forward by 30 min",
      afterExtend.booking.endAt.toISOString(),
      new Date(beforeEndAt.getTime() + 30 * 60_000).toISOString(),
    );
    const extRow = await client.extension.findUniqueOrThrow({ where: { id: extension.extension.id } });
    check("27. extension becomes APPROVED once paid", extRow.status, "APPROVED");

    // ── 10. Checkout with overage (D5) ───────────────────────────────────────
    // The effective end is scheduledEndAt + extendedMinutes, and the session was
    // extended by 30 above, so the schedule has to move back past BOTH the grace
    // period and that extension for real overage to exist.
    const sessionWithExtension = await client.session.findUniqueOrThrow({
      where: { id: checkedIn.session.id },
    });
    const overrunMinutes = settings.graceMinutes + 5 + sessionWithExtension.extendedMinutes;
    await client.session.update({
      where: { id: checkedIn.session.id },
      data: { scheduledEndAt: new Date(Date.now() - overrunMinutes * 60_000) },
    });

    const ended = await endSession({ sessionId: checkedIn.session.id, staff });
    check("28. ending the session charges overage past the grace period", ended.overage > 0, true);
    check("29. bill equals what is owed plus overage", ended.bill, ended.owed + ended.overage);

    const finalRow = await client.payment.findFirstOrThrow({
      where: { bookingId: created.booking.id, kind: "FINAL" },
    });
    check("30. checkout creates a FINAL payment for the bill", finalRow.amount, ended.bill);

    const completed = await verifyPayment({ paymentId: finalRow.id, staff, approve: true });
    check("31. settling the bill completes the booking", completed.booking.status, "COMPLETED");

    const sessionRow = await client.session.findUniqueOrThrow({ where: { id: checkedIn.session.id } });
    check("32. session is ENDED", sessionRow.status, "ENDED");
    check("33. session records the actual end time", sessionRow.actualEndAt !== null, true);

    // ── 11. Audit trail & notification outbox (§57, §32) ─────────────────────
    const auditRows = await client.auditLog.findMany({
      where: { bookingId: created.booking.id },
      orderBy: { createdAt: "asc" },
    });
    const actions = auditRows.map((a) => a.action);
    check("34. audit trail records booking creation", actions.includes("booking.created"), true);
    check("35. audit trail records payment confirmation", actions.includes("payment.confirmed.deposit"), true);
    check("36. audit trail records check-in", actions.includes("booking.checked_in"), true);
    check("37. audit trail records session end", actions.includes("session.ended"), true);
    check(
      "38. every audit row for this booking is scoped to it",
      auditRows.every((r) => r.bookingId === created.booking.id),
      true,
    );

    // Dispatch is normally wired to after(), which needs a request scope. This
    // script has none, so the outbox is drained explicitly to prove the
    // PENDING → SENT path and that a missing provider is logged, not thrown.
    await dispatchPendingNotifications();

    const notes = await client.notificationLog.findMany({
      where: { bookingId: created.booking.id },
      orderBy: { createdAt: "asc" },
    });
    check("39. notifications were queued for the outbox", notes.length >= 3, true);
    check(
      "40. every queued notification carries a body and a recipient",
      notes.every((n) => n.body.length > 0 && n.recipient.length > 0),
      true,
    );
    check(
      "41. BOOKING_CREATED message was dispatched to SENT",
      notes.some((n) => n.event === "BOOKING_CREATED" && n.status === "SENT"),
      true,
    );
    check(
      "42. no notification was left FAILED (log-only mode must not error)",
      notes.some((n) => n.status === "FAILED"),
      false,
    );

    // ── 12. Table released (§53) ─────────────────────────────────────────────
    const released = await getAvailability({ date: dateStr, startMin, durationMin });
    check(
      "43. table is bookable again once the booking is COMPLETED",
      released.find((r) => r.tableId === target.tableId)!.available,
      true,
    );
  } finally {
    const codes = bookingCode ? [bookingCode] : [];
    const { count } = await client.booking.deleteMany({
      where: { OR: [{ code: { in: codes } }, { customerPhone: { in: ["081234567890", "089999999999"] } }] },
    });
    console.log(`\ncleanup: removed ${count} flow booking(s)`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await client.$disconnect();
    await db.$disconnect();
  });
