import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStaff } from "@/auth.ts";
import { handler } from "@/lib/api.ts";
import { verifyPayment } from "@/lib/bookings.ts";
import { dispatchAfterResponse } from "@/lib/notify.ts";

/**
 * Confirm a payment — Project.md §21 (QRIS) and §24 (cash at counter).
 *
 * One endpoint for both methods: the difference is only which payment row is
 * being approved, and the transition that follows is decided by payment.kind,
 * not by which button the cashier pressed.
 *
 * Idempotent. A double-click, or a retry after a dropped response, returns the
 * same booking without applying the transition twice.
 */

const body = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const POST = handler(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const staff = await requireStaff();
    const { id } = await ctx.params;

    let payload: unknown = {};
    try {
      payload = await req.json();
    } catch {
      // A confirm with no body is valid — nothing to parse.
    }
    const parsed = body.safeParse(payload ?? {});
    const reason = parsed.success ? parsed.data.reason : undefined;

    const result = await verifyPayment({
      paymentId: id,
      staff: { type: "STAFF", id: staff.id, name: staff.name },
      approve: true,
      reason,
    });

    dispatchAfterResponse();

    return NextResponse.json({
      bookingCode: result.booking.code,
      bookingStatus: result.booking.status,
      alreadyApplied: result.alreadyApplied,
    });
  },
);
