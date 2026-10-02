import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, handler } from "@/lib/api.ts";
import { createBooking } from "@/lib/bookings.ts";
import { dispatchAfterResponse } from "@/lib/notify.ts";

/**
 * Create a booking — Project.md §13, §15, §16.
 *
 * An Idempotency-Key header is required. A customer on a flaky connection will
 * retry this request, and two bookings for the same customer is worse than a
 * confusing error. The key is stored on the booking and replayed requests return
 * the original instead of creating a second one.
 */

const body = z.object({
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().trim().min(8).max(20),
  tableId: z.string().min(1),
  startAt: z.string().datetime({ offset: true }),
  durationMin: z.number().int().min(30).max(720),
  paymentMethod: z.enum(["QRIS", "CASH_AT_COUNTER"]),
});

export const POST = handler(async (req: Request) => {
  const idempotencyKey = req.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 100) {
    return apiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Header Idempotency-Key wajib diisi",
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Body harus berupa JSON");
  }

  const parsed = body.safeParse(payload);
  if (!parsed.success) {
    return apiError(400, "INVALID_INPUT", "Data booking tidak lengkap", parsed.error.flatten());
  }

  const { booking, replayed } = await createBooking({
    ...parsed.data,
    startAt: new Date(parsed.data.startAt),
    idempotencyKey,
  });

  dispatchAfterResponse();

  return NextResponse.json(
    {
      code: booking.code,
      status: booking.status,
      tableId: booking.tableId,
      startAt: booking.startAt,
      endAt: booking.endAt,
      totalPrice: booking.totalPrice,
      depositAmount: booking.depositAmount,
      remainingAmount: booking.remainingAmount,
      holdExpiresAt: booking.holdExpiresAt,
    },
    { status: replayed ? 200 : 201 },
  );
});