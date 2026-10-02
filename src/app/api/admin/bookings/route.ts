import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStaff } from "@/auth.ts";
import { apiError, handler } from "@/lib/api.ts";
import { createWalkIn } from "@/lib/bookings.ts";

/**
 * Walk-in booking — Project.md §47.
 *
 * Same tables and same session flow as an online booking (§73 Rule 7), with no
 * deposit: the customer is at the counter and settles at checkout.
 */

const body = z.object({
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().trim().min(8).max(20),
  tableId: z.string().min(1),
  startAt: z.string().datetime({ offset: true }),
  durationMin: z.number().int().min(30).max(720),
});

export const POST = handler(async (req: Request) => {
  const staff = await requireStaff();

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Body harus berupa JSON");
  }

  const parsed = body.safeParse(payload);
  if (!parsed.success) {
    return apiError(400, "INVALID_INPUT", "Data walk-in tidak lengkap", parsed.error.flatten());
  }

  const result = await createWalkIn({
    ...parsed.data,
    startAt: new Date(parsed.data.startAt),
    staff: { type: "STAFF", id: staff.id, name: staff.name },
  });

  return NextResponse.json(
    {
      code: result.booking.code,
      status: result.booking.status,
      sessionId: result.session.id,
      totalPrice: result.totalPrice,
      scheduledEndAt: result.session.scheduledEndAt,
    },
    { status: 201 },
  );
});
