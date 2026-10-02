import type { Metadata, Viewport } from "next";

import { MobileShell } from "@/components/mobile.tsx";
import { MobileFloor } from "@/components/mobileFloor.tsx";
import { currentStaff } from "@/auth.ts";
import { redirect } from "next/navigation";
import { db } from "@/lib/db.ts";
import { expireLapsedHolds } from "@/lib/sweep.ts";
import { getTableStates } from "@/lib/tableState.ts";

export const metadata: Metadata = { title: "Floor Ops — Cue & Rail" };
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#fbf9f5",
};

/**
 * Mobile floor ops — mobile_floor_ops_cashier_command.
 *
 * This path is NOT covered by the `/admin` middleware matcher, which only matches
 * `/admin` and `/admin/*`. The session check here is therefore the only thing
 * standing between an anonymous visitor and live operational data — it is not
 * optional and must not be removed in the belief that middleware handles it.
 */
export default async function MobileAdminPage() {
  // requireStaff() throws UnauthorizedError, which surfaces as a 500 in a page.
  // A signed-out visitor should be sent to sign in, not shown a stack trace.
  const staff = await currentStaff();
  if (!staff) redirect("/admin/masuk?next=/m/admin");

  await expireLapsedHolds();

  const [states, sessions, pending] = await Promise.all([
    getTableStates(),
    db.session.findMany({
      where: { status: { in: ["ACTIVE", "OVERDUE"] } },
      select: { id: true, tableId: true, scheduledEndAt: true, extendedMinutes: true },
    }),
    db.payment.findMany({
      where: {
        kind: "DEPOSIT",
        status: { in: ["PENDING", "PROOF_SUBMITTED"] },
        booking: { status: "AWAITING_DEPOSIT" },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        amount: true,
        method: true,
        status: true,
        proofPath: true,
        booking: {
          select: {
            code: true,
            customerName: true,
            table: { select: { code: true } },
          },
        },
      },
    }),
  ]);

  const sessionByTable = new Map(sessions.map((s) => [s.tableId, s]));

  const floor = states.map((t) => {
    const s = sessionByTable.get(t.tableId);
    return {
      tableId: t.tableId,
      code: t.code,
      name: t.name,
      zone: t.zone,
      state: t.state,
      bookingCode: t.bookingCode,
      customerName: t.customerName,
      sessionId: s?.id ?? null,
      busyUntil: s
        ? new Date(s.scheduledEndAt.getTime() + s.extendedMinutes * 60_000).toISOString()
        : t.busyUntil?.toISOString() ?? null,
      holdExpiresAt: t.holdExpiresAt?.toISOString() ?? null,
    };
  });

  const counts = states.reduce(
    (acc, t) => {
      acc[t.state] = (acc[t.state] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <MobileShell active="/m/admin" title="Floor Ops" subtitle={`${states.length} meja`}>
      <MobileFloor
        floor={floor}
        pending={pending.map((p) => ({
          id: p.id,
          amount: p.amount,
          method: p.method,
          status: p.status,
          bookingCode: p.booking.code,
          tableCode: p.booking.table.code,
          customerName: p.booking.customerName,
          hasProof: Boolean(p.proofPath),
        }))}
        counts={{
          available: counts.AVAILABLE ?? 0,
          occupied: counts.OCCUPIED ?? 0,
          held: counts.HELD ?? 0,
          maintenance: counts.MAINTENANCE ?? 0,
        }}
      />
    </MobileShell>
  );
}
