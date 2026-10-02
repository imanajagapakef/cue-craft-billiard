import { NextResponse } from "next/server";

import { apiError, handler } from "@/lib/api.ts";
import { db } from "@/lib/db.ts";
import { requireOwnBookingByCode } from "@/lib/bookings.ts";

/**
 * Booking detail — Project.md §49, §57.
 *
 * Requires the phone number as well as the code. A code is four base-32
 * characters and gets read aloud in a queue; the pair is the credential.
 *
 * Also returns the §57 timeline, read from audit_logs rather than a second table.
 */

export const GET = handler(
  async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
    const { code } = await ctx.params;
    const phone = new URL(req.url).searchParams.get("phone") ?? "";
    if (!phone) {
      return apiError(400, "PHONE_REQUIRED", "Nomor HP wajib diisi");
    }

    const booking = await requireOwnBookingByCode(code, phone);

    const [table, payments, session, timeline] = await Promise.all([
      db.table.findUniqueOrThrow({ where: { id: booking.tableId } }),
      db.payment.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: "asc" } }),
      db.session.findFirst({
        where: { bookingId: booking.id, status: { in: ["ACTIVE", "OVERDUE"] } },
      }),
      db.auditLog.findMany({
        // Every audit row carries bookingId, so this one indexed lookup returns
        // payment confirmations, check-ins, and session events alongside booking
        // state changes — the full §57 timeline.
        where: { bookingId: booking.id },
        orderBy: { createdAt: "asc" },
        take: 100,
      }),
    ]);

    return NextResponse.json({
      code: booking.code,
      status: booking.status,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      table: { code: table.code, name: table.name, type: table.type, zone: table.zone },
      startAt: booking.startAt,
      endAt: booking.endAt,
      durationMinutes: booking.durationMinutes,
      totalPrice: booking.totalPrice,
      depositAmount: booking.depositAmount,
      remainingAmount: booking.remainingAmount,
      holdExpiresAt: booking.holdExpiresAt,
      checkedInAt: booking.checkedInAt,
      cancelParty: booking.cancelParty,
      cancelReason: booking.cancelReason,
      session: session
        ? {
            id: session.id,
            status: session.status,
            startedAt: session.startedAt,
            scheduledEndAt: session.scheduledEndAt,
            extendedMinutes: session.extendedMinutes,
          }
        : null,
      payments: payments.map((p) => ({
        kind: p.kind,
        method: p.method,
        status: p.status,
        amount: p.amount,
        proofUploadedAt: p.proofUploadedAt,
        rejectionReason: p.rejectionReason,
      })),
      timeline: timeline.map((t) => ({
        at: t.createdAt,
        action: t.action,
        actorName: t.actorName,
        after: t.after,
        reason: t.reason,
      })),
    });
  },
);
