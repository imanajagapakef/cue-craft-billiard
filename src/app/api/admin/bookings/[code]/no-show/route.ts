import { NextResponse } from "next/server";

import { requireStaff } from "@/auth.ts";
import { handler } from "@/lib/api.ts";
import { markNoShow } from "@/lib/bookings.ts";
import { dispatchAfterResponse } from "@/lib/notify.ts";

/**
 * Mark a confirmed booking as a no-show — Project.md §51.
 *
 * Refused until the grace period after startAt has passed; the service returns
 * TOO_EARLY with the time the grace period ends.
 */

export const POST = handler(
  async (_req: Request, ctx: { params: Promise<{ code: string }> }) => {
    const staff = await requireStaff();
    const { code } = await ctx.params;

    const result = await markNoShow({
      bookingCode: code.toUpperCase(),
      staff: { type: "STAFF", id: staff.id, name: staff.name },
    });

    dispatchAfterResponse();
    return NextResponse.json({ bookingCode: result.booking.code, status: result.booking.status });
  },
);
