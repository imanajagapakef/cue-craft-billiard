import type { Metadata } from "next";

import { AdminShell } from "@/components/adminShell.tsx";
import { CashierDesk } from "@/components/cashierDesk.tsx";
import { SectionTitle, minutesOfDay } from "@/components/ui.tsx";
import { db } from "@/lib/db.ts";
import { getTableStates } from "@/lib/tableState.ts";
import { expireLapsedHolds } from "@/lib/sweep.ts";

export const metadata: Metadata = { title: "Meja Kasir — Cue & Rail" };
export const dynamic = "force-dynamic";

/**
 * Cashier desk — cashier_booking_payment_command.
 *
 * Free tables for the walk-in form are derived from live state rather than a
 * separate availability query, so a table that went HELD a second ago cannot be
 * offered here. The walk-in POST still goes through the same constraint, so this
 * list is a convenience, not a guarantee.
 */
export default async function KasirPage() {
  await expireLapsedHolds();

  const [states, sessions, pendingCount, todayCount, hours] = await Promise.all([
    getTableStates(),
    db.session.findMany({
      where: { status: { in: ["ACTIVE", "OVERDUE"] } },
      orderBy: { startedAt: "asc" },
      include: { booking: { include: { table: true } } },
    }),
    db.payment.count({ where: { status: { in: ["PENDING", "PROOF_SUBMITTED"] } } }),
    db.booking.count({
      where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    }),
    db.operatingHour.findFirst({ where: { active: true }, orderBy: { weekday: "asc" } }),
  ]);

  const now = new Date();
  const today = new Date(now.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 10);
  const opens = hours?.opensAtMin ?? 600;
  const next = Math.ceil(Math.max(minutesOfDay(now), opens) / 30) * 30;

  const freeTables = states
    .filter((t) => t.state === "AVAILABLE")
    .map((t) => ({
      tableId: t.tableId,
      code: t.code,
      name: t.name,
      type: t.type,
      zone: t.zone,
    }));

  return (
    <AdminShell active="kasir" pendingPayments={pendingCount}>
      <SectionTitle
        eyebrow="Counter Command"
        title="Meja kasir"
        action={
          <span className="font-mono text-label-sm text-ink-muted">
            {freeTables.length} meja kosong
          </span>
        }
      />

      <div className="mt-6">
        <CashierDesk
          activeSessions={sessions.map((s) => ({
            id: s.id,
            tableCode: s.booking.table.code,
            customerName: s.booking.customerName,
            bookingCode: s.booking.code,
            startedAt: s.startedAt.toISOString(),
            endsAt: new Date(
              s.scheduledEndAt.getTime() + s.extendedMinutes * 60_000,
            ).toISOString(),
          }))}
          freeTables={freeTables}
          defaultDate={today}
          defaultStartMin={next > 23 * 60 ? opens : next}
          defaultDurationMin={120}
          todayCount={todayCount}
        />
      </div>
    </AdminShell>
  );
}
