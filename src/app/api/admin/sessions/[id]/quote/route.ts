import { NextResponse } from "next/server";

import { requireStaff } from "@/auth.ts";
import { handler } from "@/lib/api.ts";
import { getExtensionQuote } from "@/lib/bookings.ts";

/**
 * What this session may still extend by — Project.md §38–40.
 *
 * Deliberately a hint, not a guarantee. `requestExtension` recomputes availability
 * at submit time (§41), and the exclusion constraint settles ties. Offering
 * "+1 hour" and failing at submit is the failure mode this endpoint exists to
 * avoid, not to prevent.
 */
export const GET = handler(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    await requireStaff();
    const { id } = await ctx.params;

    const quote = await getExtensionQuote(id);
    return NextResponse.json(quote);
  },
);
