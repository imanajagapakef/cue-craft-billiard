/**
 * Booking codes — Project.md §14.
 *
 * Format BK-XXXX from a Postgres sequence, in a base-32 alphabet with no I/L/O/U
 * because these get read aloud to cashiers over the phone. The sequence only
 * supplies candidates: the real guarantee is the UNIQUE index on bookings.code,
 * so the caller retries on a collision.
 */

import type { PrismaClient, Prisma } from "@prisma/client";

import { bookingCodeFromSeq } from "./availability.ts";

const MAX_ATTEMPTS = 5;

export class BookingCodeExhausted extends Error {
  constructor() {
    super("Could not allocate a unique booking code");
    this.name = "BookingCodeExhausted";
  }
}

/**
 * Reserve the next code from the sequence and hand it to `create`.
 *
 * `create` receives a candidate and must insert a booking with it. A unique
 * violation means the candidate was taken by a concurrent insert, so the next
 * candidate is tried. Passing the insert in rather than returning a code keeps
 * the retry inside one transaction, where a rolled-back sequence value is not
 * actually consumed.
 */
export async function withBookingCode<T>(
  db: PrismaClient | Prisma.TransactionClient,
  create: (code: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rows = await db.$queryRawUnsafe<{ nextval: bigint }[]>(
      `SELECT nextval('booking_code_seq') AS nextval`,
    );
    const code = bookingCodeFromSeq(Number(rows[0].nextval));

    try {
      return await create(code);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Collision on the unique index — take the next candidate.
    }
  }
  throw new BookingCodeExhausted();
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  return (err as { code?: unknown }).code === "P2002";
}