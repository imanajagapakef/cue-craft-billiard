import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStaff } from "@/auth.ts";
import { handler } from "@/lib/api.ts";
import { verifyPayment } from "@/lib/bookings.ts";
import { dispatchAfterResponse } from "@/lib/notify.ts";

/**
 * Reject a payment — Project.md §22.
 *
 * A rejection never confirms the booking. The hold keeps its original expiry so
 * the customer can re-upload within the window they were already given; extending
 * it would be a policy the spec does not state.
 */

const body = z.object({
  reason: z.string().trim().min(1, "Alasan wajib diisi").max(500),
});

export const POST = handler(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const staff = await requireStaff();
    const { id } = await ctx.params;

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const parsed = body.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "REASON_REQUIRED",
            message: "Alasan penolakan wajib diisi",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 },
      );
    }

    const result = await verifyPayment({
      paymentId: id,
      staff: { type: "STAFF", id: staff.id, name: staff.name },
      approve: false,
      reason: parsed.data.reason,
    });

    dispatchAfterResponse();

    return NextResponse.json({
      bookingCode: result.booking.code,
      bookingStatus: result.booking.status,
      alreadyApplied: result.alreadyApplied,
    });
  },
);
