import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, handler } from "@/lib/api.ts";
import { getAvailability } from "@/lib/bookings.ts";

/**
 * Public availability — Project.md §10.
 *
 * Read-only and unauthenticated: this is the page a customer loads before they
 * have any account. It runs the same lazy hold expiry as the admin views so a
 * lapsed hold never shows as a held table.
 */

const query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus format YYYY-MM-DD"),
  startMin: z.coerce.number().int().min(0).max(1439),
  durationMin: z.coerce.number().int().min(30).max(720),
});

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const parsed = query.safeParse({
    date: url.searchParams.get("date"),
    startMin: url.searchParams.get("startMin"),
    durationMin: url.searchParams.get("durationMin"),
  });

  if (!parsed.success) {
    return apiError(400, "INVALID_INPUT", "Parameter tidak lengkap", parsed.error.flatten());
  }

  const rows = await getAvailability(parsed.data);
  return NextResponse.json({
    date: parsed.data.date,
    startMin: parsed.data.startMin,
    durationMin: parsed.data.durationMin,
    tables: rows,
  });
});