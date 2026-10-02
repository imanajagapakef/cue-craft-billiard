/**
 * Booking service — the operational core, Project.md §13–§55.
 *
 * Every state change in the system funnels through this file. Route handlers stay
 * thin: parse input, call one of these, shape the response. That keeps the rules
 * in one place rather than scattered across handlers where two of them will
 * eventually disagree.
 *
 * Two invariants hold throughout:
 *   - The `no_overlap` exclusion constraint is the authority on conflicts. The
 *     pre-checks below exist to produce a good error message, not to guarantee
 *     correctness (§64).
 *   - Booking time and actual session time stay separate fields (§73 Rule 14).
 */

import type { NotificationEvent, Prisma } from "@prisma/client";

import { db } from "./db.ts";
import {
  allowedExtensionIncrements,
  endFromDuration,
  durationMinutes,
  isTableFree,
  maxExtensionMinutes,
  withinOperatingHours,
  WIB_OFFSET_MIN,
  type Reservation,
} from "./availability.ts";
import { depositAmount, overageCharge, priceRange, settleableBalance } from "./pricing.ts";
import { depositPolicy, getSettings, type Settings } from "./settings.ts";
import { audit, bookingSnapshot, customerActor, type Actor } from "./audit.ts";
import { withBookingCode } from "./bookingCode.ts";
import { queueNotification, type BookingContext } from "./notify.ts";

/** Statuses that own a slot. Mirrors the WHERE clause on the `no_overlap` constraint. */
const RESERVING = ["PENDING", "AWAITING_DEPOSIT", "CONFIRMED", "CHECKED_IN"] as const;

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Time helpers ──────────────────────────────────────────────────────────────

/** Absolute instant for a local wall-clock date + minutes-from-midnight. */
export function localInstant(dateStr: string, minutes: number): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) throw new DomainError("INVALID_DATE", "Tanggal tidak valid");
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - WIB_OFFSET_MIN * 60_000);
}

const dayLabel = (d: Date) =>
  d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });

const timeLabel = (d: Date) =>
  d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

const rangeLabel = (a: Date, b: Date) => `${timeLabel(a)}–${timeLabel(b)}`;

function isWeekend(d: Date): boolean {
  const day = new Date(d.getTime() + WIB_OFFSET_MIN * 60_000).getUTCDay();
  return day === 0 || day === 6;
}

/** Operating window for the weekday a booking starts on. */
async function operatingWindowFor(start: Date) {
  const day = new Date(start.getTime() + WIB_OFFSET_MIN * 60_000).getUTCDay();
  const row = await db.operatingHour.findUnique({ where: { weekday: day } });
  if (!row || !row.active) {
    throw new DomainError("VENUE_CLOSED", "Venue tutup pada hari itu", 400);
  }
  return { weekday: day, opensAtMin: row.opensAtMin, closesAtMin: row.closesAtMin };
}

async function assertWithinOperatingHours(start: Date, end: Date): Promise<void> {
  const window = await operatingWindowFor(start);
  if (!withinOperatingHours(start, end, window)) {
    throw new DomainError(
      "OUTSIDE_OPERATING_HOURS",
      `Jam operasional hari itu ${minutesToLabel(window.opensAtMin)}–${minutesToLabel(window.closesAtMin)} WIB`,
    );
  }
}

const minutesToLabel = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ── Availability — §62, §63 ───────────────────────────────────────────────────

export type AvailabilityRow = {
  tableId: string;
  code: string;
  name: string;
  type: "REGULAR" | "VIP";
  zone: string | null;
  available: boolean;
  totalPrice: number;
  depositAmount: number;
  slices: { minutes: number; hourlyPrice: number; subtotal: number }[];
};

/**
 * Which tables can be booked for a window, and what each costs.
 *
 * Availability is derived, never stored (§4 of TECH_DESIGN). Three sources feed
 * the conflict check: unexpired holds, confirmed/checked-in bookings, and running
 * sessions that have overrun their scheduled end.
 */
export async function getAvailability(args: {
  date: string;
  startMin: number;
  durationMin: number;
}): Promise<AvailabilityRow[]> {
  if (args.durationMin <= 0 || args.durationMin > 24 * 60) {
    throw new DomainError("INVALID_DURATION", "Durasi tidak valid");
  }
  if (args.startMin < 0 || args.startMin >= 1440) {
    throw new DomainError("INVALID_START", "Jam mulai tidak valid");
  }

  const settings = await getSettings();
  const start = localInstant(args.date, args.startMin);
  const end = endFromDuration(start, args.durationMin);
  await assertWithinOperatingHours(start, end);

  const requested = { start, end };

  // A hold that has lapsed must not block, even before its row is swept.
  const now = new Date();
  const [tables, bookings, sessions] = await Promise.all([
    db.table.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.booking.findMany({
      where: {
        status: { in: [...RESERVING] },
        startAt: { lt: end },
        endAt: { gt: start },
        OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
      },
      select: { tableId: true, startAt: true, endAt: true },
    }),
    db.session.findMany({
      where: { status: { in: ["ACTIVE", "OVERDUE"] } },
      select: { tableId: true, startedAt: true, scheduledEndAt: true, extendedMinutes: true },
    }),
  ]);

  const reservations: Reservation[] = [
    ...bookings.map((b) => ({ tableId: b.tableId, start: b.startAt, end: b.endAt, active: true })),
    ...sessions.map((s) => ({
      tableId: s.tableId,
      start: s.startedAt,
      end: new Date(s.scheduledEndAt.getTime() + s.extendedMinutes * 60_000),
      active: true,
    })),
  ];

  const weekend = isWeekend(start);
  const rules = await db.pricingRule.findMany({ where: { active: true } });

  return tables.map((t) => {
    const inMaintenance = t.status === "MAINTENANCE";
    const free = !inMaintenance && isTableFree(requested, t.id, reservations, settings.bufferMinutes);

    const typeRules = rules
      .filter((r) => r.tableType === t.type)
      .map((r) => ({
        tableType: r.tableType,
        weekendOnly: r.weekendOnly,
        startsAtMin: r.startsAtMin,
        endsAtMin: r.endsAtMin,
        hourlyPrice: r.hourlyPrice,
        active: r.active,
      }));

    const quote = free ? priceRange(start, end, typeRules, weekend) : null;
    const total = quote?.total ?? 0;

    return {
      tableId: t.id,
      code: t.code,
      name: t.name,
      type: t.type,
      zone: t.zone,
      available: free,
      totalPrice: total,
      depositAmount: free ? depositAmount(total, depositPolicy(settings)) : 0,
      slices: (quote?.slices ?? []).map((s) => ({
        minutes: s.minutes,
        hourlyPrice: s.hourlyPrice,
        subtotal: s.subtotal,
      })),
    };
  });
}

// ── Create booking — §13, §15, §16 ────────────────────────────────────────────

export type CreateBookingInput = {
  customerName: string;
  customerPhone: string;
  tableId: string;
  startAt: Date;
  durationMin: number;
  paymentMethod: "QRIS" | "CASH_AT_COUNTER";
  idempotencyKey?: string;
};

export async function createBooking(input: CreateBookingInput) {
  const settings = await getSettings();

  // Replay guard first: a retried request must not create a second booking.
  if (input.idempotencyKey) {
    const existing = await db.booking.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { booking: existing, replayed: true };
  }

  const end = endFromDuration(input.startAt, input.durationMin);
  await assertWithinOperatingHours(input.startAt, end);

  const table = await db.table.findUnique({ where: { id: input.tableId } });
  if (!table || !table.active) throw new DomainError("TABLE_NOT_FOUND", "Meja tidak ditemukan", 404);
  if (table.status === "MAINTENANCE") {
    throw new DomainError("TABLE_MAINTENANCE", "Meja sedang dalam maintenance");
  }

  const rules = await db.pricingRule.findMany({ where: { active: true, tableType: table.type } });
  const quote = priceRange(input.startAt, end, rules, isWeekend(input.startAt));
  if (quote.total <= 0 || quote.unpricedMinutes > 0) {
    throw new DomainError("NO_PRICING", "Belum ada aturan harga untuk jam tersebut");
  }

  const deposit = depositAmount(quote.total, depositPolicy(settings));

  // Hold runs from NOW, not from the booking's start time. A booking for next week
  // must still be paid for within 15 minutes of being created, or every
  // far-future slot would sit in HELD indefinitely.
  const holdExpiresAt = new Date(Date.now() + settings.holdDurationMinutes * 60_000);

  return db.$transaction(async (tx) => {
    const booking = await withBookingCode(tx, (code) =>
      tx.booking.create({
        data: {
          code,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          tableId: table.id,
          startAt: input.startAt,
          endAt: end,
          durationMinutes: durationMinutes(input.startAt, end),
          totalPrice: quote.total,
          depositAmount: deposit,
          remainingAmount: quote.total - deposit,
          status: "AWAITING_DEPOSIT",
          source: "ONLINE",
          holdExpiresAt,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      }),
    );

    await tx.payment.create({
      data: {
        bookingId: booking.id,
        kind: "DEPOSIT",
        method: input.paymentMethod,
        status: "PENDING",
        amount: deposit,
      },
    });

    await queueNotification(tx, {
      event: "BOOKING_CREATED",
      bookingId: booking.id,
      ctx: await buildContext(tx, booking.id, { venueName: settings.venueName }),
    });

    await audit(tx, {
      actor: customerActor(input.customerName),
      action: "booking.created",
      entity: "booking",
      entityId: booking.id,
      bookingId: booking.id,
      after: bookingSnapshot(booking),
      reason: `DP ${deposit} via ${input.paymentMethod}`,
    });

    return { booking, replayed: false };
  });
}

// ── QRIS proof — §19, §20 ─────────────────────────────────────────────────────

export async function submitProof(args: {
  bookingCode: string;
  customerPhone: string;
  proofPath: string;
}) {
  const settings = await getSettings();
  const booking = await requireOwnBooking(args.bookingCode, args.customerPhone);

  const payment = await db.payment.findFirst({
    where: { bookingId: booking.id, kind: "DEPOSIT" },
  });
  if (!payment) throw new DomainError("NO_PAYMENT", "Booking ini tidak punya tagihan DP");
  if (payment.status === "PROOF_SUBMITTED") {
    throw new DomainError("ALREADY_SUBMITTED", "Bukti pembayaran sudah terkirim", 409);
  }
  if (payment.status === "PAID") {
    throw new DomainError("ALREADY_PAID", "Pembayaran ini sudah dikonfirmasi", 409);
  }

  const now = new Date();
  if (booking.holdExpiresAt && booking.holdExpiresAt < now) {
    throw new DomainError("HOLD_EXPIRED", "Hold booking ini sudah kedaluwarsa", 409);
  }

  const updated = await db.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: payment.id },
      data: { status: "PROOF_SUBMITTED", proofPath: args.proofPath, proofUploadedAt: now },
    });

    await queueNotification(tx, {
      event: "PAYMENT_PROOF_SUBMITTED",
      bookingId: booking.id,
      ctx: await buildContext(tx, booking.id, { venueName: settings.venueName }),
    });

    await audit(tx, {
      actor: customerActor(booking.customerName),
      action: "payment.proof_submitted",
      entity: "payment",
      entityId: payment.id,
      bookingId: booking.id,
      before: { status: payment.status },
      after: { status: "PROOF_SUBMITTED", proofPath: args.proofPath },
    });

    return p;
  });

  return updated;
}

// ── Verify payment — §21, §22, §24 ────────────────────────────────────────────

/**
 * Approve or reject a payment.
 *
 * Confirming a deposit also confirms the booking (§15). Confirming an extension
 * payment applies the extra time. Confirming a final settlement completes the
 * booking. One verification path, three transitions — each driven by
 * `payment.kind`, never by which endpoint the cashier clicked.
 */
export async function verifyPayment(args: {
  paymentId: string;
  staff: Actor;
  approve: boolean;
  reason?: string;
}) {
  const settings = await getSettings();

  const payment = await db.payment.findUnique({
    where: { id: args.paymentId },
    include: { booking: { include: { table: true } } },
  });
  if (!payment) throw new DomainError("PAYMENT_NOT_FOUND", "Pembayaran tidak ditemukan", 404);

  // Idempotent (§8): a second confirm returns the same outcome, never reapplies.
  if (args.approve && payment.status === "PAID") {
    return { booking: payment.booking, payment, alreadyApplied: true };
  }
  if (!args.approve && payment.status === "REJECTED") {
    return { booking: payment.booking, payment, alreadyApplied: true };
  }
  if (payment.status === "PAID" || payment.status === "REFUNDED") {
    throw new DomainError("PAYMENT_SETTLED", "Pembayaran ini sudah selesai", 409);
  }

  if (!args.approve) return rejectPayment(payment, settings, args);

  const event: NotificationEvent =
    payment.kind === "EXTENSION" ? "EXTENSION_CONFIRMED" : "PAYMENT_CONFIRMED";

  const result = await db.$transaction(async (tx) => {
    const now = new Date();

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        verifiedById: args.staff.id ?? null,
        verifiedAt: now,
        rejectionReason: null,
      },
    });

    const booking =
      payment.kind === "EXTENSION"
        ? await applyExtensionTime(tx, payment)
        : payment.kind === "FINAL"
          ? await completeBooking(tx, payment)
          : await confirmDeposit(tx, payment, now);

    await queueNotification(tx, {
      event,
      bookingId: booking.id,
      ctx: await buildContext(tx, booking.id, { venueName: settings.venueName }),
    });

    await audit(tx, {
      actor: { type: "STAFF", id: args.staff.id ?? null, name: args.staff.name ?? null },
      action: `payment.confirmed.${payment.kind.toLowerCase()}`,
      entity: "payment",
      entityId: payment.id,
      bookingId: booking.id,
      before: { status: payment.status, kind: payment.kind },
      after: { status: "PAID", kind: payment.kind, bookingStatus: booking.status },
    });

    return booking;
  });

  return { booking: result, payment, alreadyApplied: false };
}

async function confirmDeposit(tx: Prisma.TransactionClient, payment: PaymentWithBooking, now: Date) {
  if (payment.booking.status !== "AWAITING_DEPOSIT") {
    throw new DomainError("BOOKING_NOT_AWAITING", "Booking tidak menunggu deposit", 409);
  }
  if (payment.booking.holdExpiresAt && payment.booking.holdExpiresAt < now) {
    throw new DomainError("HOLD_EXPIRED", "Hold booking sudah kedaluwarsa", 409);
  }

  return tx.booking.update({
    where: { id: payment.bookingId },
    data: { status: "CONFIRMED", holdExpiresAt: null },
  });
}

async function completeBooking(tx: Prisma.TransactionClient, payment: PaymentWithBooking) {
  if (payment.booking.status !== "CHECKED_IN") {
    throw new DomainError("BOOKING_NOT_CHECKED_IN", "Booking belum di-check-in", 409);
  }
  return tx.booking.update({
    where: { id: payment.bookingId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

async function rejectPayment(payment: PaymentWithBooking, settings: Settings, args: { staff: Actor; reason?: string }) {
  // §22: rejection must NOT confirm the booking. The hold keeps running so the
  // customer can re-upload within the window they already have. Extending the
  // hold here would be a policy the spec does not state, so it is not done.
  const updated = await db.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "REJECTED",
        rejectionReason: args.reason ?? null,
        verifiedById: args.staff.id ?? null,
        verifiedAt: new Date(),
        proofPath: null,
      },
    });

    await queueNotification(tx, {
      event: "PAYMENT_REJECTED",
      bookingId: payment.bookingId,
      ctx: await buildContext(tx, payment.bookingId, {
        venueName: settings.venueName,
        rejectionReason: args.reason ?? null,
      }),
    });

    await audit(tx, {
      actor: { type: "STAFF", id: args.staff.id ?? null, name: args.staff.name ?? null },
      action: "payment.rejected",
      entity: "payment",
      entityId: payment.id,
      bookingId: payment.bookingId,
      before: { status: payment.status },
      after: { status: "REJECTED", reason: args.reason ?? null },
      reason: args.reason ?? null,
    });

    return p;
  });

  return { booking: payment.booking, payment: updated, alreadyApplied: false };
}

type PaymentWithBooking = Prisma.PaymentGetPayload<{
  include: { booking: { include: { table: true } } };
}>;

// ── Check-in — §34, §35, §36 ──────────────────────────────────────────────────

export async function checkIn(args: { bookingCode: string; staff: Actor }) {
  const booking = await db.booking.findUnique({
    where: { code: args.bookingCode },
    include: { table: true, sessions: { where: { status: { in: ["ACTIVE", "OVERDUE"] } } } },
  });
  if (!booking) throw new DomainError("BOOKING_NOT_FOUND", "Booking tidak ditemukan", 404);

  if (booking.status === "CHECKED_IN") {
    const active = booking.sessions[0];
    if (active) return { booking, session: active, alreadyCheckedIn: true };
  }
  if (booking.status !== "CONFIRMED") {
    throw new DomainError("NOT_CONFIRMED", `Booking berstatus ${booking.status}, belum CONFIRMED`, 409);
  }

  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    // D4: started_at is the real check-in; scheduled_end_at stays anchored to
    // the booked end so a late arrival costs the customer, not the next booking.
    const session = await tx.session.create({
      data: {
        bookingId: booking.id,
        tableId: booking.tableId,
        startedAt: now,
        scheduledEndAt: booking.endAt,
        status: "ACTIVE",
      },
    });

    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { status: "CHECKED_IN", checkedInAt: now },
    });

    await audit(tx, {
      actor: { type: "STAFF", id: args.staff.id ?? null, name: args.staff.name ?? null },
      action: "booking.checked_in",
      entity: "booking",
      entityId: booking.id,
      bookingId: booking.id,
      before: bookingSnapshot(booking),
      after: bookingSnapshot(updated),
    });

    return { booking: updated, session };
  });

  return { ...result, alreadyCheckedIn: false };
}

// ── Extension — §37–§45 ───────────────────────────────────────────────────────

export type ExtensionQuote = {
  canExtend: boolean;
  maxMinutes: number;
  increments: number[];
  priceByMinutes: Record<string, number>;
  reason: string | null;
};

async function loadExtendableSession(sessionId: string) {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: { booking: { include: { table: true } }, extensions: true },
  });
  if (!session) throw new DomainError("SESSION_NOT_FOUND", "Sesi tidak ditemukan", 404);
  if (session.status === "ENDED") throw new DomainError("SESSION_ENDED", "Sesi sudah selesai", 409);
  if (session.booking.status !== "CHECKED_IN") {
    throw new DomainError("NOT_CHECKED_IN", "Booking belum di-check-in", 409);
  }
  return session;
}

/** Current effective session end, after any approved extension. */
function sessionEnd(s: { scheduledEndAt: Date; extendedMinutes: number }): Date {
  return endFromDuration(s.scheduledEndAt, s.extendedMinutes);
}

async function quoteExtensionFor(sessionId: string, settings?: Settings): Promise<ExtensionQuote> {
  const s = settings ?? (await getSettings());
  const session = await loadExtendableSession(sessionId);
  const end = sessionEnd(session);

  const next = await nextBookingOnTable(session.tableId, end);

  const max = maxExtensionMinutes({
    sessionEnd: end,
    nextBooking: next,
    closesAtMin: await closingMinutesFor(end),
    bufferMinutes: s.bufferMinutes,
    maxMinutes: s.extensionMaxMinutes,
  });

  const rates = await db.pricingRule.findMany({
    where: { active: true, tableType: session.booking.table.type },
  });
  const weekend = isWeekend(end);

  const priceByMinutes: Record<string, number> = {};
  for (const inc of s.extensionIncrementsMinutes) {
    priceByMinutes[String(inc)] = priceRange(end, endFromDuration(end, inc), rates, weekend).total;
  }

  return {
    canExtend: max > 0,
    maxMinutes: max,
    increments: allowedExtensionIncrements(max, s.extensionIncrementsMinutes),
    priceByMinutes,
    reason: max > 0 ? null : next ? "Ada booking berikutnya yang tidak bisa digeser" : "Waktu operational tidak cukup",
  };
}

/** Next active reservation on a table after a given instant. */
async function nextBookingOnTable(tableId: string, after: Date) {
  const now = new Date();
  const next = await db.booking.findFirst({
    where: {
      tableId,
      status: { in: ["AWAITING_DEPOSIT", "CONFIRMED"] },
      startAt: { gt: after },
      OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
    },
    orderBy: { startAt: "asc" },
    select: { startAt: true, endAt: true, code: true },
  });
  return next ? { start: next.startAt, end: next.endAt } : null;
}

async function closingMinutesFor(at: Date): Promise<number> {
  const day = new Date(at.getTime() + WIB_OFFSET_MIN * 60_000).getUTCDay();
  const row = await db.operatingHour.findUnique({ where: { weekday: day } });
  return row?.closesAtMin ?? 1440;
}

/**
 * Public wrapper for the session control screen. Exists so the route handler
 * does not reach into a private helper.
 */
export async function getExtensionQuote(sessionId: string): Promise<ExtensionQuote> {
  return quoteExtensionFor(sessionId);
}

/**
 * Request an extension. Availability is re-checked HERE, at submit, and this is
 * the authoritative check (§41) — the quote the customer saw is only a hint.
 *
 * The extension is created as a payment, not applied directly: time is granted
 * when that payment is confirmed, which reuses the deposit verification path.
 */
export async function requestExtension(args: {
  sessionId: string;
  minutes: number;
  staff: Actor;
  requestedByName?: string;
  /** Staff override for a blocking next booking (§45). Requires a reason. */
  overrideReason?: string;
}) {
  const settings = await getSettings();
  const session = await loadExtendableSession(args.sessionId);

  const end = sessionEnd(session);
  const newEnd = endFromDuration(end, args.minutes);
  await assertWithinOperatingHours(end, newEnd);

  const quote = await quoteExtensionFor(args.sessionId, settings);
  const needsOverride = args.minutes > quote.maxMinutes;

  if (needsOverride && !args.overrideReason?.trim()) {
    throw new DomainError(
      "EXTENSION_TOO_LONG",
      `Maksimal ${quote.maxMinutes} menit${quote.reason ? ` (${quote.reason})` : ""}`,
      409,
      { maxMinutes: quote.maxMinutes, reason: quote.reason },
    );
  }

  const rates = await db.pricingRule.findMany({
    where: { active: true, tableType: session.booking.table.type },
  });
  const price = priceRange(end, newEnd, rates, isWeekend(end)).total;
  if (price <= 0) throw new DomainError("NO_PRICING", "Tidak ada aturan harga untuk jam extension");

  return db.$transaction(async (tx) => {
    const extension = await tx.extension.create({
      data: {
        sessionId: session.id,
        bookingId: session.bookingId,
        requestedMinutes: args.minutes,
        approvedMinutes: args.minutes,
        price,
        status: "PENDING",
        requestedByName: args.requestedByName ?? null,
        reason: args.overrideReason ?? null,
      },
    });

    await tx.payment.create({
      data: {
        bookingId: session.bookingId,
        extensionId: extension.id,
        kind: "EXTENSION",
        method: "CASH_AT_COUNTER",
        status: "PENDING",
        amount: price,
      },
    });

    await audit(tx, {
      actor: { type: "STAFF", id: args.staff.id ?? null, name: args.staff.name ?? null },
      action: needsOverride ? "extension.requested_override" : "extension.requested",
      entity: "extension",
      entityId: extension.id,
      bookingId: session.bookingId,
      after: { minutes: args.minutes, price, override: Boolean(args.overrideReason) },
      reason: args.overrideReason ?? null,
    });

    return { extension, price, needsOverride };
  });
}

/**
 * Grant the extra time. Called when the extension payment is confirmed.
 *
 * When an admin overrode a blocking next booking, the blocking booking is shifted
 * forward by exactly the overlap. That shift is manual, reasoned, audited (§45),
 * never automatic. It is a single level: if the shifted booking would then collide
 * with the one after it, the transaction fails rather than cascading.
 */
async function applyExtensionTime(
  tx: Prisma.TransactionClient,
  payment: PaymentWithBooking,
) {
  const extension = payment.extensionId
    ? await tx.extension.findUnique({ where: { id: payment.extensionId } })
    : null;
  if (!extension) throw new DomainError("EXTENSION_NOT_FOUND", "Extension tidak ditemukan", 404);

  const session = await tx.session.findUniqueOrThrow({ where: { id: extension.sessionId } });
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: extension.bookingId } });

  const end = sessionEnd(session);
  const newEnd = endFromDuration(end, extension.approvedMinutes);

  // Shift a blocking next booking forward by the overlap, when there is one.
  const blocker = await tx.booking.findFirst({
    where: {
      tableId: booking.tableId,
      status: { in: ["AWAITING_DEPOSIT", "CONFIRMED"] },
      startAt: { lt: newEnd },
      endAt: { gt: end },
      id: { not: booking.id },
    },
    orderBy: { startAt: "asc" },
  });

  if (blocker) {
    if (!extension.reason) {
      throw new DomainError(
        "EXTENSION_BLOCKED",
        "Ada booking berikutnya di slot itu. Perlu override dengan alasan.",
        409,
      );
    }
    const shiftMs = newEnd.getTime() - blocker.startAt.getTime();
    await tx.booking.update({
      where: { id: blocker.id },
      data: { startAt: newEnd, endAt: new Date(blocker.endAt.getTime() + shiftMs) },
    });
    await audit(tx, {
      actor: { type: "STAFF", name: extension.reason },
      action: "booking.shifted_by_extension_override",
      entity: "booking",
      entityId: blocker.id,
      // Belongs to the displaced customer's timeline, not the extending one.
      bookingId: blocker.id,
      before: { startAt: blocker.startAt.toISOString(), endAt: blocker.endAt.toISOString() },
      after: { startAt: newEnd.toISOString(), shiftedByMinutes: Math.round(shiftMs / 60_000) },
      reason: extension.reason,
    });
  }

  await tx.session.update({
    where: { id: session.id },
    data: { extendedMinutes: session.extendedMinutes + extension.approvedMinutes },
  });
  const updatedBooking = await tx.booking.update({
    where: { id: booking.id },
    data: { endAt: newEnd },
  });

  await tx.extension.update({
    where: { id: extension.id },
    data: { status: "APPROVED", approvedAt: new Date() },
  });

  return updatedBooking;
}

// ── Checkout — §53 ─────────────────────────────────────────────────────────────

export async function endSession(args: { sessionId: string; staff: Actor }) {
  const settings = await getSettings();
  const session = await db.session.findUnique({
    where: { id: args.sessionId },
    include: { booking: { include: { table: true, payments: true } } },
  });
  if (!session) throw new DomainError("SESSION_NOT_FOUND", "Sesi tidak ditemukan", 404);
  if (session.status === "ENDED") throw new DomainError("SESSION_ENDED", "Sesi sudah selesai", 409);

  const now = new Date();
  const scheduledEnd = sessionEnd(session);

  const rates = await db.pricingRule.findMany({
    where: { active: true, tableType: session.booking.table.type },
  });
  const prevailing = priceRange(
    scheduledEnd,
    endFromDuration(scheduledEnd, 15),
    rates,
    isWeekend(scheduledEnd),
  ).total;

  // If no rule covers the scheduled end, stop. Pricing an overrun at zero would
  // silently forgive real money, so a gap in pricing_rules is surfaced to the
  // operator rather than absorbed.
  if (prevailing <= 0) {
    throw new DomainError(
      "NO_PRICING",
      `Belum ada aturan harga untuk ${timeLabel(scheduledEnd)} WIB. Perbaiki pricing_rules sebelum menutup sesi.`,
      409,
    );
  }
  const hourlyAtEnd = Math.round((prevailing / 15) * 60);

  const overage = overageCharge({
    actualEnd: now,
    scheduledEndAt: scheduledEnd,
    graceMinutes: settings.graceMinutes,
    incrementMinutes: settings.overageIncrementMinutes,
    hourlyPrice: hourlyAtEnd,
  });

  const extensionTotal = session.extendedMinutes > 0 ? await extensionTotalFor(session.id) : 0;
  const paidTotal = session.booking.payments
    .filter((p) => p.status === "PAID")
    .reduce((sum, p) => sum + p.amount, 0);

  const owed = settleableBalance({
    totalPrice: session.booking.totalPrice,
    extensionTotal,
    paidTotal,
  });
  const bill = owed + overage;

  const result = await db.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: session.id },
      data: { status: "ENDED", actualEndAt: now },
    });

    if (bill > 0) {
      await tx.payment.create({
        data: {
          bookingId: session.bookingId,
          kind: "FINAL",
          method: "CASH_AT_COUNTER",
          status: "PENDING",
          amount: bill,
        },
      });
    } else {
      // Nothing left to collect — close it out immediately rather than leaving a
      // booking stuck in CHECKED_IN with no way to finish.
      await tx.booking.update({
        where: { id: session.bookingId },
        data: { status: "COMPLETED", completedAt: now },
      });
    }

    await audit(tx, {
      actor: { type: "STAFF", id: args.staff.id ?? null, name: args.staff.name ?? null },
      action: "session.ended",
      entity: "session",
      entityId: session.id,
      bookingId: session.bookingId,
      before: { status: session.status, scheduledEndAt: scheduledEnd.toISOString() },
      after: { status: "ENDED", actualEndAt: now.toISOString(), overage, bill },
    });

    return { overage, bill, owed, extensionTotal };
  });

  return { ...result, sessionId: session.id };
}

async function extensionTotalFor(sessionId: string): Promise<number> {
  const rows = await db.extension.findMany({
    where: { sessionId, status: "APPROVED" },
    select: { price: true },
  });
  return rows.reduce((sum, r) => sum + r.price, 0);
}

// ── Walk-in — §47, §73 Rule 7 ─────────────────────────────────────────────────

/**
 * A customer who is standing at the counter.
 *
 * Creates the booking and the session in one transaction so a table is never left
 * reserved by a half-finished walk-in. No deposit: the customer is present and
 * settles at checkout, and §73 Rule 7 requires this to use the same tables and
 * session flow as an online booking rather than a parallel path.
 */
export async function createWalkIn(args: {
  customerName: string;
  customerPhone: string;
  tableId: string;
  startAt: Date;
  durationMin: number;
  staff: Actor;
}) {
  const end = endFromDuration(args.startAt, args.durationMin);
  await assertWithinOperatingHours(args.startAt, end);

  const table = await db.table.findUnique({ where: { id: args.tableId } });
  if (!table || !table.active) throw new DomainError("TABLE_NOT_FOUND", "Meja tidak ditemukan", 404);
  if (table.status === "MAINTENANCE") {
    throw new DomainError("TABLE_MAINTENANCE", "Meja sedang dalam maintenance");
  }

  const rules = await db.pricingRule.findMany({ where: { active: true, tableType: table.type } });
  const quote = priceRange(args.startAt, end, rules, isWeekend(args.startAt));
  if (quote.total <= 0) throw new DomainError("NO_PRICING", "Tidak ada aturan harga untuk jam tersebut");

  const now = new Date();

  return db.$transaction(async (tx) => {
    const booking = await withBookingCode(tx, (code) =>
      tx.booking.create({
        data: {
          code,
          customerName: args.customerName,
          customerPhone: args.customerPhone,
          tableId: table.id,
          startAt: args.startAt,
          endAt: end,
          durationMinutes: durationMinutes(args.startAt, end),
          totalPrice: quote.total,
          // No deposit for a walk-in: nothing is being reserved ahead of time.
          depositAmount: 0,
          remainingAmount: quote.total,
          status: "CHECKED_IN",
          source: "WALK_IN",
          holdExpiresAt: null,
          checkedInAt: now,
        },
      }),
    );

    const session = await tx.session.create({
      data: {
        bookingId: booking.id,
        tableId: table.id,
        startedAt: now,
        scheduledEndAt: end,
        status: "ACTIVE",
      },
    });

    await audit(tx, {
      actor: { type: "STAFF", id: args.staff.id ?? null, name: args.staff.name ?? null },
      action: "booking.walk_in",
      entity: "booking",
      entityId: booking.id,
      bookingId: booking.id,
      after: { ...bookingSnapshot(booking), tableCode: table.code, sessionId: session.id },
      reason: "Walk-in, dibayar di kasir",
    });

    return { booking, session, totalPrice: quote.total };
  });
}

// ── Cancel & no-show — §52, §51 ───────────────────────────────────────────────

const CANCELLABLE = ["PENDING", "AWAITING_DEPOSIT", "CONFIRMED"] as const;

export async function cancelBooking(args: {
  bookingCode: string;
  party: "CUSTOMER" | "VENUE";
  reason?: string;
  staff?: Actor;
  /** Required when party is CUSTOMER — a code alone must not cancel a booking. */
  customerPhone?: string;
}) {
  const settings = await getSettings();

  // Ownership first, before any state is read into scope. A venue-side cancel
  // comes from an authenticated staff action and has no phone attached.
  const booking =
    args.party === "CUSTOMER"
      ? await requireOwnBooking(args.bookingCode, args.customerPhone ?? "")
      : await db.booking.findUnique({ where: { code: args.bookingCode.toUpperCase() } });

  if (!booking) throw new DomainError("BOOKING_NOT_FOUND", "Booking tidak ditemukan", 404);
  if (!CANCELLABLE.includes(booking.status as (typeof CANCELLABLE)[number])) {
    throw new DomainError("NOT_CANCELLABLE", `Booking ${booking.status} tidak bisa dibatalkan`, 409);
  }

  // D3: staff cancelling for a venue reason requires a recorded reason.
  if (args.party === "VENUE" && !args.reason?.trim()) {
    throw new DomainError("REASON_REQUIRED", "Pembatalan oleh venue wajib menyertakan alasan");
  }

  const hoursUntilStart = (booking.startAt.getTime() - Date.now()) / 3_600_000;
  const freeCancel = hoursUntilStart >= settings.cancelFreeUntilHours;
  // Venue-caused cancellation always refunds. Customer-caused follows the window.
  const refundable = args.party === "VENUE" || freeCancel;

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelParty: args.party,
        cancelReason: args.reason ?? null,
        holdExpiresAt: null,
      },
    });

    if (refundable) {
      await tx.payment.updateMany({
        where: { bookingId: booking.id, status: "PAID" },
        data: { status: "REFUNDED", refundedAt: new Date() },
      });
    }

    await queueNotification(tx, {
      event: "BOOKING_CANCELLED",
      bookingId: booking.id,
      ctx: await buildContext(tx, booking.id, { venueName: settings.venueName }),
    });

    await audit(tx, {
      actor: args.staff
        ? { type: "STAFF", id: args.staff.id ?? null, name: args.staff.name ?? null }
        : customerActor(booking.customerName),
      action: "booking.cancelled",
      entity: "booking",
      entityId: booking.id,
      bookingId: booking.id,
      before: bookingSnapshot(booking),
      after: { ...bookingSnapshot(updated), cancelParty: args.party, refundable },
      reason: args.reason ?? null,
    });

    return updated;
  });

  return { booking: result, refundable, hoursUntilStart };
}

export async function markNoShow(args: { bookingCode: string; staff: Actor }) {
  const settings = await getSettings();
  const booking = await db.booking.findUnique({ where: { code: args.bookingCode } });
  if (!booking) throw new DomainError("BOOKING_NOT_FOUND", "Booking tidak ditemukan", 404);
  if (booking.status !== "CONFIRMED") {
    throw new DomainError("NOT_CONFIRMED", `Booking ${booking.status} belum CONFIRMED`, 409);
  }

  const graceEnds = new Date(booking.startAt.getTime() + settings.noShowGraceMinutes * 60_000);
  if (Date.now() < graceEnds.getTime()) {
    throw new DomainError(
      "TOO_EARLY",
      `Grace period masih berjalan sampai ${timeLabel(graceEnds)} WIB`,
      409,
    );
  }

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { status: "NO_SHOW", noShowAt: new Date() },
    });

    // §51/D3: a no-show forfeits the deposit. Recorded as REFUNDED would be a lie,
    // so the payment is left PAID and the forfeiture is captured in the audit row.
    await queueNotification(tx, {
      event: "NO_SHOW",
      bookingId: booking.id,
      ctx: await buildContext(tx, booking.id, { venueName: settings.venueName }),
    });

    await audit(tx, {
      actor: { type: "STAFF", id: args.staff.id ?? null, name: args.staff.name ?? null },
      action: "booking.no_show",
      entity: "booking",
      entityId: booking.id,
      bookingId: booking.id,
      before: bookingSnapshot(booking),
      after: bookingSnapshot(updated),
      reason: "Deposit forfeited per cancellation policy D3",
    });

    return updated;
  });

  return { booking: result };
}

// ── Shared ────────────────────────────────────────────────────────────────────

/**
 * Booking code plus phone is the credential. A code alone is not enough to read
 * or change a booking — codes are 4 base-32 characters and get shoulder-surfed.
 */
async function requireOwnBooking(code: string, phone: string) {
  const digits = phone.replace(/\D/g, "");
  const booking = await db.booking.findUnique({ where: { code: code.toUpperCase() } });
  if (!booking) throw new DomainError("BOOKING_NOT_FOUND", "Booking tidak ditemukan", 404);

  const stored = booking.customerPhone.replace(/\D/g, "");
  const tail = stored.slice(-Math.min(8, stored.length));
  if (!digits.endsWith(tail)) {
    throw new DomainError("PHONE_MISMATCH", "Nomor HP tidak cocok dengan booking ini", 403);
  }
  return booking;
}

export async function requireOwnBookingByCode(code: string, phone: string) {
  return requireOwnBooking(code, phone);
}

/** Build the notification context from a booking row. */
async function buildContext(
  tx: Prisma.TransactionClient,
  bookingId: string,
  extra: { venueName: string; rejectionReason?: string | null },
): Promise<BookingContext> {
  const b = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { table: true },
  });

  return {
    code: b.code,
    venueName: extra.venueName,
    customerName: b.customerName,
    customerPhone: b.customerPhone,
    tableCode: b.table.code,
    dateLabel: dayLabel(b.startAt),
    timeLabel: rangeLabel(b.startAt, b.endAt),
    totalPrice: b.totalPrice,
    depositAmount: b.depositAmount,
    remainingAmount: b.remainingAmount,
    holdExpiresAt: b.holdExpiresAt,
    detailUrl: `/booking/${b.code}`,
    rejectionReason: extra.rejectionReason ?? null,
  };
}

export { RESERVING };
