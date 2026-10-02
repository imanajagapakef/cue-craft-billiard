import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, handler } from "@/lib/api.ts";
import { cancelBooking } from "@/lib/bookings.ts";
import { dispatchAfterResponse } from "@/lib/notify.ts";

/**
 * Cancel a booking — Project.md §52, policy D3.
 *
 * `party` is required and defaults to CUSTOMER. Only the customer path is
 * available here: a venue-initiated cancellation is a staff action and goes
 * through the admin surface, where a reason is mandatory and audited.
 *
 * The phone number is required, same as every other customer-facing booking
 * action. A booking code alone must not be able to cancel someone's reservation.
 */

const body = z.object({
  phone: z.string().trim().min(8).max(20),
  party: z.literal("CUSTOMER").default("CUSTOMER"),
  reason: z.string().trim().max(500).optional(),
});

export const POST = handler(
  async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
    const { code } = await ctx.params;

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return apiError(400, "INVALID_JSON", "Body harus berupa JSON");
    }

    const parsed = body.safeParse(payload);
    if (!parsed.success) {
      return apiError(400, "INVALID_INPUT", "Data tidak lengkap", parsed.error.flatten());
    }

    // Ownership is verified in the service against the stored phone. Checking it
    // here as well would be a second, weaker copy of the same rule.
    const result = await cancelBooking({
      bookingCode: code.toUpperCase(),
      party: parsed.data.party,
      reason: parsed.data.reason,
      customerPhone: parsed.data.phone,
    });

    dispatchAfterResponse();

    return NextResponse.json({
      code: result.booking.code,
      status: result.booking.status,
      refundable: result.refundable,
      hoursUntilStart: Math.round(result.hoursUntilStart * 10) / 10,
    });
  },
);
