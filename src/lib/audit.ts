/**
 * Audit log — Project.md §58.
 *
 * Every state-changing action writes a row here. The same table serves the §57
 * booking timeline, because filtering by `entity = 'booking'` and `entityId` gives
 * exactly that. Two tables would have been two sources of truth for one timeline.
 */

import type { AuditActorType, Prisma, PrismaClient } from "@prisma/client";

export type Actor = {
  type: AuditActorType;
  id?: string | null;
  name?: string | null;
};

export const SYSTEM_ACTOR: Actor = { type: "SYSTEM" };
export const customerActor = (name: string): Actor => ({ type: "CUSTOMER", name });

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Writes an audit row. Takes a transaction client so it joins the caller's
 * transaction — an audit row that survives a rolled-back change is worse than
 * none, because it documents something that did not happen.
 */
export async function audit(
  db: Db,
  args: {
    actor: Actor;
    action: string;
    entity: string;
    entityId?: string | null;
    /** The booking this action belongs to, so §57's timeline is one lookup. */
    bookingId?: string | null;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorType: args.actor.type,
      actorId: args.actor.id ?? null,
      actorName: args.actor.name ?? null,
      bookingId: args.bookingId ?? null,
      action: args.action,
      entity: args.entity,
      entityId: args.entityId ?? null,
      before: (args.before ?? null) as Prisma.InputJsonValue,
      after: (args.after ?? null) as Prisma.InputJsonValue,
      reason: args.reason ?? null,
    },
  });
}

/**
 * The subset of booking fields worth showing in a timeline entry. Deliberately
 * excludes nothing sensitive — the table has no secrets — but excludes noise
 * like `updatedAt`, which changes on every touch and makes diffs unreadable.
 */
export function bookingSnapshot(b: {
  status: string;
  startAt: Date;
  endAt: Date;
  totalPrice: number;
  depositAmount: number;
  remainingAmount: number;
  holdExpiresAt?: Date | null;
}) {
  return {
    status: b.status,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    totalPrice: b.totalPrice,
    depositAmount: b.depositAmount,
    remainingAmount: b.remainingAmount,
    holdExpiresAt: b.holdExpiresAt ? b.holdExpiresAt.toISOString() : null,
  };
}