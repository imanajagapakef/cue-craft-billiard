import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStaff } from "@/auth.ts";
import { handler } from "@/lib/api.ts";
import { requestExtension } from "@/lib/bookings.ts";

/**
 * Request an extension — Project.md §37, §41, §45.
 *
 * This is the re-check that §41 insists on: availability is recomputed here, at
 * submit, and the earlier quote is treated as a hint. When the request exceeds
 * what is actually available the service refuses with EXTENSION_TOO_LONG and the
 * real maximum; a staff member may override by sending overrideReason, which is
 * recorded and audited (§45).
 *
 * Time is NOT granted here. This creates a payment; the extra minutes are applied
 * when that payment is confirmed, which reuses the deposit verification path and
 * re-checks the constraint one final time.
 */

const body = z.object({
  minutes: z.number().int().min(15).max(240),
  requestedByName: z.string().trim().max(80).optional(),
  overrideReason: z.string().trim().max(500).optional(),
});

export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
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
          code: "INVALID_INPUT",
          message: "Data extension tidak valid",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const result = await requestExtension({
    sessionId: id,
    minutes: parsed.data.minutes,
    staff: { type: "STAFF", id: staff.id, name: staff.name },
    requestedByName: parsed.data.requestedByName,
    overrideReason: parsed.data.overrideReason,
  });

  return NextResponse.json(
    {
      extensionId: result.extension.id,
      minutes: result.extension.approvedMinutes,
      price: result.price,
      status: result.extension.status,
      usedOverride: result.needsOverride,
    },
    { status: 201 },
  );
});
