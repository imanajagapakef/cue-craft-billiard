import { NextResponse } from "next/server";

import { requireStaff } from "@/auth.ts";
import { handler } from "@/lib/api.ts";
import { endSession } from "@/lib/bookings.ts";

/**
 * End a session and produce the bill — Project.md §53.
 *
 * Overage past the grace period is charged here in whole increment blocks. If
 * anything is owed, a FINAL payment row is created and the cashier settles it
 * through the same confirm endpoint as a deposit; that confirm flips the booking
 * to COMPLETED. Nothing owed means it completes immediately.
 */

export const POST = handler(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const staff = await requireStaff();
    const { id } = await ctx.params;

    const result = await endSession({
      sessionId: id,
      staff: { type: "STAFF", id: staff.id, name: staff.name },
    });

    return NextResponse.json({
      sessionId: result.sessionId,
      overage: result.overage,
      extensionTotal: result.extensionTotal,
      owed: result.owed,
      bill: result.bill,
    });
  },
);
