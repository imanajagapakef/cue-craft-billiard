import { NextResponse } from "next/server";

import { requireStaff } from "@/auth.ts";
import { handler } from "@/lib/api.ts";
import { checkIn } from "@/lib/bookings.ts";

/**
 * Check-in — Project.md §34.
 *
 * Searching by code is the whole interaction; the code is what the customer
 * reads from their confirmation message.
 */

export const POST = handler(
  async (_req: Request, ctx: { params: Promise<{ code: string }> }) => {
    const staff = await requireStaff();
    const { code } = await ctx.params;

    const result = await checkIn({
      bookingCode: code.toUpperCase(),
      staff: { type: "STAFF", id: staff.id, name: staff.name },
    });

    return NextResponse.json({
      bookingCode: result.booking.code,
      bookingStatus: result.booking.status,
      sessionId: result.session.id,
      startedAt: result.session.startedAt,
      scheduledEndAt: result.session.scheduledEndAt,
      alreadyCheckedIn: result.alreadyCheckedIn,
    });
  },
);
