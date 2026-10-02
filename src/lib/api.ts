/**
 * API error shape — docs/TECH_DESIGN.md §9.
 *
 * One shape everywhere so the client never parses two. `409 SLOT_TAKEN` is the
 * only conflict a customer can trigger and it always means the same thing:
 * someone else got there first, pick a different time.
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { ForbiddenError, UnauthorizedError } from "@/auth.ts";
import { DomainError } from "@/lib/bookings.ts";

export type ApiError = {
  error: { code: string; message: string; details?: unknown };
};

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

/** Prisma error codes we handle by name. P2002 = unique violation, P2028 = timeout. */
function prismaCode(e: unknown): string | null {
  if (typeof e === "object" && e && "code" in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  return null;
}

/**
 * Postgres SQLSTATE for a failed exclusion-constraint check. This is the
 * double-booking guard firing — the transaction lost the race and must roll back.
 */
const EXCLUSION_VIOLATION = "23P01";

/**
 * Wrap a route handler so every failure leaves as the standard error shape.
 * Nothing else in the codebase needs to construct an error response by hand.
 */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<NextResponse>,
) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      return await fn(...args);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export function toErrorResponse(err: unknown): NextResponse<ApiError> {
  if (err instanceof UnauthorizedError) {
    return apiError(401, "UNAUTHORIZED", "Authentication required");
  }
  if (err instanceof ForbiddenError) {
    return apiError(403, "FORBIDDEN", "Insufficient permissions");
  }
  // Business-rule refusals already carry their own status and code, so the client
  // can tell "slot taken" apart from "you are not allowed to do that".
  if (err instanceof DomainError) {
    return apiError(err.status, err.code, err.message, err.details);
  }
  if (err instanceof ZodError) {
    return apiError(400, "INVALID_INPUT", "Request failed validation", err.flatten());
  }

  const rawMessage = err instanceof Error ? err.message : String(err);

  // The exclusion constraint fired: someone else holds this slot.
  if (rawMessage.includes(EXCLUSION_VIOLATION)) {
    return apiError(
      409,
      "SLOT_TAKEN",
      "That time slot was just taken. Please choose another.",
    );
  }

  // Any unique violation is a duplicate submission rather than a server fault.
  if (prismaCode(err) === "P2002") {
    return apiError(409, "DUPLICATE", "That record already exists");
  }

  console.error("[api] unhandled error", err);
  return apiError(500, "INTERNAL", "Something went wrong. Please try again.");
}

/**
 * Assert a database exclusion-constraint conflict.
 *
 * Prisma surfaces the raw Postgres error text rather than a typed code, so this
 * matches on SQLSTATE. Kept as a predicate rather than inline string checks so
 * the one place that knows the driver's error shape is this line.
 */
export function isSlotConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes(EXCLUSION_VIOLATION) || msg.includes("no_overlap");
}