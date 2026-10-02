/**
 * Lazy hold expiry — docs/TECH_DESIGN.md §6.
 *
 * Neon's free tier suspends compute when idle, which takes pg_cron with it. Rather
 * than a worker that is unreliable in dev and costs money in production, expired
 * holds are swept when data is read. A hold that has lapsed is marked EXPIRED the
 * next time anyone looks at it, which is exactly when the answer matters.
 *
 * Trade-off, stated in TECH_DESIGN.md §6: if nobody ever requests availability, a
 * lapsed row stays AWAITING_DEPOSIT until something reads it. The stored status is
 * then stale but the slot is still correctly free, because every read treats a
 * lapsed hold as absent regardless of the stored status.
 *
 * There is deliberately no "reclaim the table" sweep. Table state is derived at
 * read time (see tableState.ts), so there is no stored table status to fall out of
 * sync and nothing to repair.
 */

import { db } from "./db.ts";
import { audit, SYSTEM_ACTOR } from "./audit.ts";

/**
 * Mark every lapsed hold as EXPIRED. Safe to call from any read path.
 * Scoped to a set of booking codes when the caller already has them, so a sweep
 * does not rewrite rows this request will not return.
 */
export async function expireLapsedHolds(codes?: string[]): Promise<number> {
  const now = new Date();

  const lapsed = await db.booking.findMany({
    where: {
      status: "AWAITING_DEPOSIT",
      holdExpiresAt: { lt: now },
      ...(codes?.length ? { code: { in: codes } } : {}),
    },
    select: { id: true, code: true, holdExpiresAt: true },
  });

  if (lapsed.length === 0) return 0;

  await db.$transaction(async (tx) => {
    for (const b of lapsed) {
      // Conditional on still being AWAITING_DEPOSIT: a deposit that landed a
      // moment ago wins this race and this update simply matches nothing.
      const changed = await tx.booking.updateMany({
        where: { id: b.id, status: "AWAITING_DEPOSIT" },
        data: { status: "EXPIRED", holdExpiresAt: null },
      });
      if (changed.count === 1) {
        await audit(tx, {
          actor: SYSTEM_ACTOR,
          action: "booking.hold_expired",
          entity: "booking",
          entityId: b.id,
          bookingId: b.id,
          before: { status: "AWAITING_DEPOSIT", holdExpiresAt: b.holdExpiresAt?.toISOString() },
          after: { status: "EXPIRED" },
        });
      }
    }
  });

  return lapsed.length;
}